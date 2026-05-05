package ledger

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuthStatus mirrors the auth_status enum in migrations/004.
type AuthStatus string

const (
	AuthPending  AuthStatus = "pending"
	AuthCaptured AuthStatus = "captured"
	AuthVoided   AuthStatus = "voided"
	AuthExpired  AuthStatus = "expired"
)

// Authorization is the "hold" record. It produces no ledger entries on its own;
// only Capture creates the balanced transaction.
type Authorization struct {
	ID             uuid.UUID  `json:"id"`
	SourceAccount  string     `json:"source_account"`
	DestAccount    string     `json:"dest_account"`
	Amount         int64      `json:"amount"`
	Currency       string     `json:"currency"`
	Status         AuthStatus `json:"status"`
	Description    string     `json:"description"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      time.Time  `json:"expires_at"`
	CapturedAt     *time.Time `json:"captured_at,omitempty"`
	VoidedAt       *time.Time `json:"voided_at,omitempty"`
	CapturedAmount *int64     `json:"captured_amount,omitempty"`
	TransactionID  *uuid.UUID `json:"transaction_id,omitempty"`
}

var (
	ErrAuthNotFound       = errors.New("ledger: authorization not found")
	ErrAuthNotPending     = errors.New("ledger: authorization is not pending")
	ErrAuthExpired        = errors.New("ledger: authorization expired")
	ErrCaptureExceedsAuth = errors.New("ledger: capture amount exceeds authorized amount")
	ErrCurrencyMismatch   = errors.New("ledger: account currency does not match requested currency")
)

// Authorize reserves `amount` from sourceCode, earmarked for an eventual
// transfer to destCode. Both accounts must exist within orgID and have the
// requested currency. The authorization is `pending` until Capture or Void.
//
// No entries are created here — Authorize does not move money. It records
// intent. Available balance for the source account is `total - SUM(pending
// authorizations on this account)` (computed in GetBalance, day 2 of W3).
func Authorize(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID uuid.UUID,
	sourceCode, destCode string,
	amount int64,
	currency, description string,
) (*Authorization, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("ledger: authorize amount must be positive, got %d", amount)
	}
	if sourceCode == destCode {
		return nil, fmt.Errorf("ledger: source and destination must differ")
	}

	sourceID, sourceCurr, err := resolveAccountCurrency(ctx, pool, orgID, sourceCode)
	if err != nil {
		return nil, fmt.Errorf("source: %w", err)
	}
	destID, destCurr, err := resolveAccountCurrency(ctx, pool, orgID, destCode)
	if err != nil {
		return nil, fmt.Errorf("dest: %w", err)
	}
	if sourceCurr != currency || destCurr != currency {
		return nil, fmt.Errorf("%w: source=%s dest=%s requested=%s",
			ErrCurrencyMismatch, sourceCurr, destCurr, currency)
	}

	auth := &Authorization{
		SourceAccount: sourceCode,
		DestAccount:   destCode,
		Amount:        amount,
		Currency:      currency,
		Description:   description,
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO authorizations (
			org_id, source_account_id, dest_account_id, amount, currency, description
		) VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, status, created_at, expires_at
	`, orgID, sourceID, destID, amount, currency, description).Scan(
		&auth.ID, &auth.Status, &auth.CreatedAt, &auth.ExpiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert authorization: %w", err)
	}
	return auth, nil
}

// Capture settles a pending authorization by creating the balanced transaction.
// captureAmount must satisfy 0 < captureAmount <= original auth amount. The
// remainder (auth.Amount - captureAmount) is implicitly released — the auth's
// status becomes 'captured' and only `captureAmount` worth of entries are written.
//
// Returns the resulting PostedTransaction. Returns ErrAuthNotFound,
// ErrAuthNotPending, ErrAuthExpired, or ErrCaptureExceedsAuth as appropriate.
func Capture(
	ctx context.Context,
	pool *pgxpool.Pool,
	authID uuid.UUID,
	captureAmount int64,
) (*PostedTransaction, error) {
	if captureAmount <= 0 {
		return nil, fmt.Errorf("ledger: capture amount must be positive, got %d", captureAmount)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		orgID, sourceID, destID    uuid.UUID
		sourceCode, destCode       string
		authAmount                 int64
		currency, description      string
		status                     AuthStatus
		expiresAt                  time.Time
	)
	// FOR UPDATE so two concurrent captures of the same auth can't both succeed.
	err = tx.QueryRow(ctx, `
		SELECT a.org_id, a.source_account_id, a.dest_account_id, a.amount,
		       a.currency, a.status, COALESCE(a.description, ''), a.expires_at,
		       src.code, dst.code
		FROM authorizations a
		JOIN accounts src ON src.id = a.source_account_id
		JOIN accounts dst ON dst.id = a.dest_account_id
		WHERE a.id = $1
		FOR UPDATE
	`, authID).Scan(
		&orgID, &sourceID, &destID, &authAmount,
		&currency, &status, &description, &expiresAt,
		&sourceCode, &destCode,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAuthNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("auth lookup: %w", err)
	}

	if status != AuthPending {
		return nil, fmt.Errorf("%w: status=%s", ErrAuthNotPending, status)
	}
	if time.Now().After(expiresAt) {
		return nil, fmt.Errorf("%w: expired_at=%s", ErrAuthExpired, expiresAt.Format(time.RFC3339))
	}
	if captureAmount > authAmount {
		return nil, fmt.Errorf("%w: authorized=%d capture=%d",
			ErrCaptureExceedsAuth, authAmount, captureAmount)
	}

	// occurred_at uses clock_timestamp() (real wall clock at INSERT time)
	// rather than now() (transaction start time). The two can differ by tens
	// of milliseconds inside a transaction, and now() can leave occurred_at
	// behind a concurrent reader's wall-clock upper bound, making
	// just-committed entries appear stale to a fresh GetBalance for ~50ms.
	var txID uuid.UUID
	var txCreatedAt, txOccurredAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (org_id, description, occurred_at)
		VALUES ($1, $2, clock_timestamp())
		RETURNING id, created_at, occurred_at
	`, orgID, description).Scan(&txID, &txCreatedAt, &txOccurredAt)
	if err != nil {
		return nil, fmt.Errorf("insert transaction: %w", err)
	}

	posted := make([]PostedEntry, 0, 2)
	for _, leg := range []struct {
		accountID uuid.UUID
		code      string
		direction Direction
	}{
		{sourceID, sourceCode, DirOut},
		{destID, destCode, DirIn},
	} {
		var entryID uuid.UUID
		err = tx.QueryRow(ctx, `
			INSERT INTO entries (transaction_id, account_id, amount, currency, direction)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id
		`, txID, leg.accountID, captureAmount, currency, string(leg.direction)).Scan(&entryID)
		if err != nil {
			return nil, fmt.Errorf("insert entry %s: %w", leg.code, err)
		}
		posted = append(posted, PostedEntry{
			ID:        entryID,
			Account:   leg.code,
			Amount:    captureAmount,
			Currency:  currency,
			Direction: leg.direction,
		})
	}

	_, err = tx.Exec(ctx, `
		UPDATE authorizations
		SET status = 'captured',
		    captured_at = now(),
		    captured_amount = $2,
		    transaction_id = $3
		WHERE id = $1
	`, authID, captureAmount, txID)
	if err != nil {
		return nil, fmt.Errorf("update auth: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		// The deferred trigger fires here. If the entries are unbalanced for any
		// reason (shouldn't be — same amount, opposite directions, same currency)
		// the COMMIT raises and we return that error.
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &PostedTransaction{
		ID:          txID,
		Description: description,
		OccurredAt:  txOccurredAt,
		CreatedAt:   txCreatedAt,
		Entries:     posted,
	}, nil
}

// Void releases a pending authorization without creating any entries. Returns
// ErrAuthNotFound if the auth doesn't exist, ErrAuthNotPending if it has
// already been captured/voided/expired.
func Void(ctx context.Context, pool *pgxpool.Pool, authID uuid.UUID) error {
	tag, err := pool.Exec(ctx, `
		UPDATE authorizations
		SET status = 'voided', voided_at = now()
		WHERE id = $1 AND status = 'pending'
	`, authID)
	if err != nil {
		return fmt.Errorf("void: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return nil
	}

	// Distinguish "not found" from "not pending".
	var status AuthStatus
	err = pool.QueryRow(ctx, `SELECT status FROM authorizations WHERE id = $1`, authID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrAuthNotFound
	}
	if err != nil {
		return fmt.Errorf("void status check: %w", err)
	}
	return fmt.Errorf("%w: status=%s", ErrAuthNotPending, status)
}

func resolveAccountCurrency(
	ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, code string,
) (uuid.UUID, string, error) {
	var id uuid.UUID
	var currency string
	err := pool.QueryRow(ctx, `
		SELECT id, currency FROM accounts WHERE org_id = $1 AND code = $2
	`, orgID, code).Scan(&id, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, "", fmt.Errorf("%w: %q", ErrUnknownAccount, code)
	}
	if err != nil {
		return uuid.Nil, "", err
	}
	return id, currency, nil
}
