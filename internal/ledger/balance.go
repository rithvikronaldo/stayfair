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
//
// Amount is the realised total — sum of all entries on the account up to the
// upper bound. OnHold is the sum of pending authorizations against the account
// (only populated for current/live queries, not historical). Available is
// Amount - OnHold and is what clients should use to decide "can this account
// afford another authorization right now?".
//
// For point-in-time queries (asOf != nil) OnHold is reported as 0 and Available
// equals Amount: we don't reconstruct historical pending state.
type Balance struct {
	Account   string     `json:"account"`
	Currency  string     `json:"currency"`
	Amount    int64      `json:"balance"`
	Available int64      `json:"available"`
	OnHold    int64      `json:"on_hold"`
	AsOf      *time.Time `json:"as_of,omitempty"`
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

	// Step 2 — pin the upper bound to the database clock. For live queries
	// (asOf nil) we ask postgres for clock_timestamp() once and bind the
	// resulting timestamp as a literal parameter to subsequent queries.
	//
	// Why pin instead of using clock_timestamp() inline: the snapshot lookup
	// and the delta sum need to agree on the same upper bound — they're
	// separate connections off the pool and inline time functions advance
	// between them. Pinning also dodges a subtle visibility issue with
	// just-committed entries on freshly-cycled pool connections.
	var upperBound time.Time
	if asOf != nil {
		upperBound = *asOf
	} else {
		if err := pool.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&upperBound); err != nil {
			return nil, fmt.Errorf("upper bound fetch: %w", err)
		}
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

	total := snapshotBalance + delta

	// Step 5 — on_hold for current queries only. Historical queries don't
	// reconstruct pending-auth state because we don't journal status changes.
	var onHold int64
	if asOf == nil {
		err = pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount), 0)
			FROM authorizations
			WHERE source_account_id = $1
			  AND currency = $2
			  AND status = 'pending'
		`, accountID, currency).Scan(&onHold)
		if err != nil {
			return nil, fmt.Errorf("on_hold sum: %w", err)
		}
	}

	return &Balance{
		Account:   code,
		Currency:  currency,
		Amount:    total,
		Available: total - onHold,
		OnHold:    onHold,
		AsOf:      asOf,
	}, nil
}

// ConvertBalance converts a balance from its native currency to a target currency
// using the FX rate at the same point in time as the balance.
//
// The conversion multiplies the native amount by the rate and rounds to the
// target currency's minor_unit_scale.
//
// Returns ErrNoRate if no exchange rate is available at or before the balance's
// point in time.
func ConvertBalance(ctx context.Context, pool *pgxpool.Pool, b *Balance, targetCurrency string) (*Balance, error) {
	// Determine the point in time for the FX lookup.
	asOf := time.Now()
	if b.AsOf != nil {
		asOf = *b.AsOf
	}

	// Look up the FX rate.
	rate, err := LookupRate(ctx, pool, b.Currency, targetCurrency, asOf)
	if err != nil {
		return nil, err
	}

	// Convert all three numbers with the same rate so the (total, available,
	// on_hold) triplet stays internally consistent in the target currency.
	convertedAmount, err := rate.Convert(b.Amount)
	if err != nil {
		return nil, fmt.Errorf("fx conversion: %w", err)
	}
	convertedAvailable, err := rate.Convert(b.Available)
	if err != nil {
		return nil, fmt.Errorf("fx conversion (available): %w", err)
	}
	convertedOnHold, err := rate.Convert(b.OnHold)
	if err != nil {
		return nil, fmt.Errorf("fx conversion (on_hold): %w", err)
	}

	return &Balance{
		Account:   b.Account,
		Currency:  targetCurrency,
		Amount:    convertedAmount,
		Available: convertedAvailable,
		OnHold:    convertedOnHold,
		AsOf:      b.AsOf,
	}, nil
}
