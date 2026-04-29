package ledger

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ComputeSnapshots calculates the end-of-day balance for every account in
// the given org on the given date and writes them to account_snapshots.
//
// Idempotent: re-running for the same (account, currency, date) overwrites
// the prior value (ON CONFLICT … DO UPDATE).
//
// "End-of-day on date D" means: sum of every entry whose parent transaction
// has occurred_at < (D + 1 day) — i.e., everything that happened on or
// before D in business time.
//
// Typical usage in production: a nightly worker calls this with yesterday's
// date for every active org. We don't have a worker yet — Friday wires up a
// `make snapshot` target for manual runs.
func ComputeSnapshots(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, asOfDate time.Time) error {
	tag, err := pool.Exec(ctx, `
		INSERT INTO account_snapshots (account_id, currency, as_of_date, balance)
		SELECT
			a.id,
			a.currency,
			$2::date,
			COALESCE((
				SELECT SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END)
				FROM entries e
				JOIN transactions t ON t.id = e.transaction_id
				WHERE e.account_id = a.id
				  AND t.occurred_at < ($2::date + INTERVAL '1 day')
			), 0)
		FROM accounts a
		WHERE a.org_id = $1
		ON CONFLICT (account_id, currency, as_of_date) DO UPDATE
			SET balance = EXCLUDED.balance, created_at = now();
	`, orgID, asOfDate)
	if err != nil {
		return fmt.Errorf("compute snapshots: %w", err)
	}
	_ = tag // RowsAffected available if we want it later
	return nil
}
