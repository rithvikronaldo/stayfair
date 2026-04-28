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
// If asOf is nil, it's the current balance — every entry summed (in - out).
// If asOf is non-nil, it's the balance as of that moment in business time —
// only entries from transactions with occurred_at <= asOf are summed.
//
// Note: filtering is on transactions.occurred_at, not entries.created_at, so
// backfilled events are reflected at the time they happened, not the time
// they were recorded.
//
// Returns ErrUnknownAccount if (org, code) doesn't exist.
//
// This is the naïve implementation — it scans every relevant entry for the
// account. Wednesday's commit replaces this with a snapshot-and-delta lookup
// for performance at scale.
func GetBalance(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, code string, asOf *time.Time) (*Balance, error) {
	var balance int64
	var currency string
	err := pool.QueryRow(ctx, `
		SELECT
			COALESCE((
				SELECT SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END)
				FROM entries e
				JOIN transactions t ON t.id = e.transaction_id
				WHERE e.account_id = a.id
				  AND ($3::timestamptz IS NULL OR t.occurred_at <= $3)
			), 0),
			a.currency
		FROM accounts a
		WHERE a.org_id = $1 AND a.code = $2
	`, orgID, code, asOf).Scan(&balance, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownAccount
	}
	if err != nil {
		return nil, fmt.Errorf("get balance for %s: %w", code, err)
	}
	return &Balance{
		Account:  code,
		Currency: currency,
		Amount:   balance,
		AsOf:     asOf,
	}, nil
}
