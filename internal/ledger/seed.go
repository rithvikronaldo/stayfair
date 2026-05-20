package ledger

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SeedNewTenant populates a freshly-created tenant with starter data so the
// dashboard is alive on first paint instead of staring at three zero-balance
// accounts. Without dense, realistic-looking history the time-scrubber has
// nothing to rewind through and the cold-visitor moment falls flat.
//
// Seeds (W5 D3 density push, 2026-05-20):
//   - 8 accounts: cash, vendor-pool, treasury-pool, fees, fx-buffer, payouts,
//     payroll, reserve. All USD. All asset-type per SpawnAgent semantics —
//     the sandbox conservation invariant holds regardless of account-type
//     accounting.
//   - 100 historical transactions over the past 24h, weighted by realistic
//     frequency and amounts (customer captures, Stripe payouts, vendor
//     payouts, wire fees, ACH returns, payroll runs, FX conversions, reserve
//     allocations, fee collection). 40% bias toward the last 6 hours so
//     recent activity is dense.
//   - 1 pending authorization — the user's first guided action target.
//
// Amounts are picked in minor units (cents) from realistic ranges so the
// dashboard shows numbers like $4,237.81, not test-money $25.00. Per-tenant
// RNG seeding keeps the history unique to each signup but deterministic
// within a tenant (rerun would produce the same shape, but seed only ever
// runs once per tenant).
//
// Performance budget: 8 SpawnAgent calls + 100 Post calls + 1 Authorize
// call, all sequential, each its own pgx transaction. Measured at ~1.5s
// locally on M-series Apple Silicon. If signup latency becomes a problem,
// move to background goroutine after the response returns.
//
// Returns the first seed error on any failure. The signup HTTP handler
// propagates it as 500; the empty tenant row is left in place (orphan
// noise) — the user retries with a different email. Don't wrap-and-rollback:
// each ledger primitive opens its own transaction and stacking begins is
// not worth the complexity for a launch seed.
func SeedNewTenant(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, tenantID uuid.UUID,
) error {
	accts := make(map[string]string, len(seedAccountNames))
	for _, name := range seedAccountNames {
		a, err := SpawnAgent(ctx, pool, orgID, tenantID, name, "USD")
		if err != nil {
			return fmt.Errorf("seed %s account: %w", name, err)
		}
		accts[name] = a.AccountCode
	}

	rng := rand.New(rand.NewSource(tenantSeed(tenantID)))
	weightTotal := 0
	for _, k := range seedTxKinds {
		weightTotal += k.weight
	}

	now := time.Now().UTC()
	for i := range seedTxCount {
		kind := pickSeedTxKind(rng, weightTotal)
		amount := kind.minMinor + rng.Int63n(kind.maxMinor-kind.minMinor+1)
		occurredAt := pickSeedOccurredAt(rng, now)

		_, err := Post(ctx, pool, orgID, tenantID, Transaction{
			Description: kind.description,
			OccurredAt:  occurredAt,
			Entries: []Entry{
				{Account: accts[kind.fromAcct], Amount: amount, Currency: "USD", Direction: DirOut},
				{Account: accts[kind.toAcct], Amount: amount, Currency: "USD", Direction: DirIn},
			},
		})
		if err != nil {
			return fmt.Errorf("seed historical tx %d (%s): %w", i, kind.description, err)
		}
	}

	// One pending auth — the first guided-flow action ("▶ Capture the pending
	// auth"). Realistic capture-shape amount; memo nudges the new user toward
	// the welcome sidebar's first button.
	pendingAmount := int64(8500 + rng.Int63n(420000))
	if _, err := Authorize(ctx, pool, orgID, tenantID,
		accts["cash"], accts["vendor-pool"],
		pendingAmount, "USD",
		"subscription capture · ready when you are · try ▶ Capture",
	); err != nil {
		return fmt.Errorf("seed pending auth: %w", err)
	}

	return nil
}

// seedAccountNames is the 8-account roster every new tenant gets. Order
// matters only for log-readability; SpawnAgent is order-independent.
var seedAccountNames = []string{
	"cash",
	"vendor-pool",
	"treasury-pool",
	"fees",
	"fx-buffer",
	"payouts",
	"payroll",
	"reserve",
}

// seedTxKind describes one synthetic transaction archetype. Amounts in USD
// minor units (cents). Weight controls relative frequency in the 100-tx mix.
type seedTxKind struct {
	description string
	fromAcct    string
	toAcct      string
	minMinor    int64
	maxMinor    int64
	weight      int
}

// seedTxKinds is the archetype roster. Amounts are picked uniformly within
// each range; the resulting cents-place variation produces realistic-looking
// figures like $4,237.81 rather than test-money round numbers.
var seedTxKinds = []seedTxKind{
	{"customer capture · subscription", "cash", "vendor-pool", 4999, 49999, 30},
	{"Stripe payout settlement", "treasury-pool", "cash", 100000, 3000000, 15},
	{"vendor payout · weekly batch", "vendor-pool", "payouts", 100000, 2500000, 10},
	{"wire fee — JPMC outbound", "cash", "fees", 1500, 4500, 10},
	{"ACH return — Wells Fargo", "vendor-pool", "cash", 5000, 50000, 8},
	{"payroll run · biweekly", "cash", "payroll", 300000, 1500000, 8},
	{"FX conversion · EUR/USD buffer", "cash", "fx-buffer", 50000, 1000000, 8},
	{"reserve allocation · regulatory", "cash", "reserve", 500000, 5000000, 6},
	{"fee collection · platform spread", "vendor-pool", "fees", 500, 20000, 5},
}

const (
	seedTxCount       = 100
	seedHistoryHours  = 24
	seedRecentBiasPct = 40 // % of txs that land in the most recent 6h window
)

// tenantSeed derives a deterministic int64 RNG seed from a tenant UUID by
// folding the first 8 bytes as big-endian and clamping to non-negative.
func tenantSeed(id uuid.UUID) int64 {
	var v uint64
	for i := range 8 {
		v = (v << 8) | uint64(id[i])
	}
	return int64(v >> 1) // shift to guarantee non-negative
}

// pickSeedTxKind picks one archetype by weighted random.
func pickSeedTxKind(rng *rand.Rand, weightTotal int) seedTxKind {
	pick := rng.Intn(weightTotal)
	for _, k := range seedTxKinds {
		if pick < k.weight {
			return k
		}
		pick -= k.weight
	}
	return seedTxKinds[len(seedTxKinds)-1]
}

// pickSeedOccurredAt returns a timestamp in the past 24h, biased toward the
// last 6h so recent activity is dense (the cold-visitor scrolls back through
// the last hour first). Adds second-level noise so timestamps don't look
// minute-aligned.
func pickSeedOccurredAt(rng *rand.Rand, now time.Time) time.Time {
	const recentMins = 6 * 60
	olderMins := (seedHistoryHours - 6) * 60
	var minsAgo int64
	if rng.Intn(100) < seedRecentBiasPct {
		minsAgo = rng.Int63n(int64(recentMins))
	} else {
		minsAgo = int64(recentMins) + rng.Int63n(int64(olderMins))
	}
	secondNoise := rng.Int63n(60)
	return now.
		Add(-time.Duration(minsAgo) * time.Minute).
		Add(-time.Duration(secondNoise) * time.Second)
}
