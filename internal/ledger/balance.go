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

// Balance is the response shape for a balance query.
type Balance struct {
	Account  string     `json:"account"`
	Currency string     `json:"currency"`
	Amount   int64      `json:"balance"`
	AsOf     *time.Time `json:"as_of,omitempty"`
}

// GetBalance returns the balance for an account.
//
// If asOf is nil, it's the current balance.
// If asOf is non-nil, it's the balance as of that moment in business time —
// only entries from transactions with occurred_at <= asOf are summed.
//
// Filtering is on transactions.occurred_at, not entries.created_at, so
// backfilled events are reflected when they happened.
//
// Returns ErrUnknownAccount if (org, code) doesn't exist.
//
// Performance: this implementation uses snapshot-and-delta replay. It looks
// for the most recent account_snapshots row dated strictly before the upper
// bound, then sums only the entries that happened after that snapshot.
// When no snapshot exists, it falls back to a full scan from time zero.
// A nightly job (or `make snapshot`) is expected to populate snapshots for
// recent dates so the delta is small.
func GetBalance(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, code string, asOf *time.Time) (*Balance, error) {
	// Step 1 — resolve the account.
	var accountID uuid.UUID
	var currency string
	err := pool.QueryRow(ctx, `
		SELECT id, currency FROM accounts
		WHERE org_id = $1 AND code = $2
	`, orgID, code).Scan(&accountID, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownAccount
	}
	if err != nil {
		return nil, fmt.Errorf("account lookup: %w", err)
	}

	// Step 2 — determine the upper bound.
	upperBound := time.Now()
	if asOf != nil {
		upperBound = *asOf
	}

	// Step 3 — find the latest snapshot strictly before the upper bound's date.
	// "Strictly before" because a snapshot for date D covers through end-of-day D,
	// so the delta below should pick up everything that happened on or after D+1.
	var snapshotBalance int64
	var deltaStart time.Time
	err = pool.QueryRow(ctx, `
		SELECT balance, (as_of_date + INTERVAL '1 day')::timestamptz
		FROM account_snapshots
		WHERE account_id = $1 AND currency = $2
		  AND as_of_date < $3::date
		ORDER BY as_of_date DESC
		LIMIT 1
	`, accountID, currency, upperBound).Scan(&snapshotBalance, &deltaStart)
	if errors.Is(err, pgx.ErrNoRows) {
		// No snapshot yet — fall back to the epoch as the delta lower bound.
		snapshotBalance = 0
		deltaStart = time.Time{}
	} else if err != nil {
		return nil, fmt.Errorf("snapshot lookup: %w", err)
	}

	// Step 4 — sum entries in (deltaStart, upperBound].
	var delta int64
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END), 0)
		FROM entries e
		JOIN transactions t ON t.id = e.transaction_id
		WHERE e.account_id = $1
		  AND t.occurred_at >= $2
		  AND t.occurred_at <= $3
	`, accountID, deltaStart, upperBound).Scan(&delta)
	if err != nil {
		return nil, fmt.Errorf("delta sum: %w", err)
	}

	return &Balance{
		Account:  code,
		Currency: currency,
		Amount:   snapshotBalance + delta,
		AsOf:     asOf,
	}, nil
}
