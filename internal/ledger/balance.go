package ledger

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Balance is the response shape for a balance query.
type Balance struct {
	Account  string `json:"account"`
	Currency string `json:"currency"`
	Amount   int64  `json:"balance"`
}

// GetBalance returns the current balance for an account, computed by summing
// every entry: in - out. Returns ErrUnknownAccount if the (org, code) pair
// doesn't exist.
//
// This is the naïve implementation — it scans every entry for the account.
// Tomorrow's commit adds an as_of parameter; Wednesday's commit replaces the
// scan with a snapshot-and-delta lookup for performance at scale.
func GetBalance(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, code string) (*Balance, error) {
	var balance int64
	var currency string
	err := pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END), 0),
			a.currency
		FROM accounts a
		LEFT JOIN entries e ON e.account_id = a.id
		WHERE a.org_id = $1 AND a.code = $2
		GROUP BY a.currency
	`, orgID, code).Scan(&balance, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownAccount
	}
	if err != nil {
		return nil, fmt.Errorf("get balance for %s: %w", code, err)
	}
	return &Balance{Account: code, Currency: currency, Amount: balance}, nil
}
