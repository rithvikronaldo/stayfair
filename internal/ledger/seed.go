package ledger

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SeedNewTenant populates a freshly-created tenant with starter data so
// the user has something to poke immediately after signup instead of an
// empty dashboard. Without this, "signup" produces the dreaded
// account-created-now-what state.
//
// Seeds:
//   - 3 accounts: cash, vendor-pool, treasury-pool (all USD)
//   - 1 funding transaction (5 min ago): treasury → cash, $100
//   - 1 activity transaction (1 min ago):  cash → vendor-pool, $50
//   - 1 pending authorization (just now):  cash → vendor-pool, $25
//
// After seed, balances are: cash=$50, vendor-pool=$50, treasury-pool=-$100,
// with $25 reserved on cash (on_hold). Two transactions are visible in the
// stream and one pending auth is ready for the user to Capture as their
// first guided action.
//
// Returns the seed error on any failure. The signup HTTP handler propagates
// it as 500; the empty tenant row is left in place (orphan noise) — the
// user retries with a different email. Don't wrap-and-rollback: the ledger
// functions each open their own pgx transaction, and stacking begins is
// not worth the complexity for a launch seed.
func SeedNewTenant(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, tenantID uuid.UUID,
) error {
	cash, err := SpawnAgent(ctx, pool, orgID, tenantID, "cash", "USD")
	if err != nil {
		return fmt.Errorf("seed cash account: %w", err)
	}
	vendor, err := SpawnAgent(ctx, pool, orgID, tenantID, "vendor-pool", "USD")
	if err != nil {
		return fmt.Errorf("seed vendor-pool account: %w", err)
	}
	treasury, err := SpawnAgent(ctx, pool, orgID, tenantID, "treasury-pool", "USD")
	if err != nil {
		return fmt.Errorf("seed treasury-pool account: %w", err)
	}

	// Funding transaction — pre-dates everything else by 5 minutes so it
	// reads as "the platform funded this tenant at signup" in the stream.
	fundingAt := time.Now().Add(-5 * time.Minute).UTC()
	_, err = Post(ctx, pool, orgID, tenantID, Transaction{
		Description: "starter funding",
		OccurredAt:  fundingAt,
		Entries: []Entry{
			{Account: treasury.AccountCode, Amount: 10000, Currency: "USD", Direction: DirOut},
			{Account: cash.AccountCode, Amount: 10000, Currency: "USD", Direction: DirIn},
		},
	})
	if err != nil {
		return fmt.Errorf("seed funding tx: %w", err)
	}

	// Activity transaction — 1 minute ago. Gives the user a non-empty
	// stream + a captured tx the time-scrubber can rewind across.
	activityAt := time.Now().Add(-1 * time.Minute).UTC()
	_, err = Post(ctx, pool, orgID, tenantID, Transaction{
		Description: "first capture · subscription",
		OccurredAt:  activityAt,
		Entries: []Entry{
			{Account: cash.AccountCode, Amount: 5000, Currency: "USD", Direction: DirOut},
			{Account: vendor.AccountCode, Amount: 5000, Currency: "USD", Direction: DirIn},
		},
	})
	if err != nil {
		return fmt.Errorf("seed activity tx: %w", err)
	}

	// Pending authorization — the user's first guided action is to Capture
	// this. Created last so its created_at is unambiguously "now".
	_, err = Authorize(ctx, pool, orgID, tenantID,
		cash.AccountCode, vendor.AccountCode,
		2500, "USD", "ready to capture · try the [Capture] button",
	)
	if err != nil {
		return fmt.Errorf("seed pending auth: %w", err)
	}

	return nil
}
