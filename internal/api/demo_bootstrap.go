// Package api — demo bootstrap.
//
// The public dashboard at acta.rithvikronaldo.dev reads the demo tenant
// without auth and the server-side simulator (demo_simulator.go) animates
// it by authorizing+capturing random pairs. Both require the demo tenant
// to actually have agents in it — the simulator picks funded same-currency
// pairs as its source/dest, and a tenant with zero accounts produces zero
// activity.
//
// Historically the frontend useSpendDriver bootstrapped the demo tenant on
// first browser load (spawning agents + funding via curl). That driver was
// removed when the simulator moved server-side, so a freshly-provisioned
// production database (e.g. a clean Neon project on launch day) has the
// migrations + currency rows but no demo agents — the dashboard reads
// empty, the simulator stays silent, and the cold-visitor moment dies.
//
// BootstrapDemoTenant fixes that by running the same SeedNewTenant routine
// we use for fresh signups against the demo tenant if it has no agents
// yet. Idempotent: if the tenant already has agents (i.e. we already
// bootstrapped, or migration 007's backfill seeded it, or someone restored
// from a snapshot), this is a no-op.

package api

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/ledger"
)

// BootstrapDemoTenant seeds the demo tenant with starter accounts +
// historical transactions if it currently has none. Safe to call on every
// startup — the existing-agents check short-circuits on subsequent boots.
func BootstrapDemoTenant(ctx context.Context, pool *pgxpool.Pool) error {
	existing, err := ledger.ListAgents(ctx, pool, demoOrgID, ledger.DemoTenantID)
	if err != nil {
		return fmt.Errorf("list demo agents: %w", err)
	}
	if len(existing) > 0 {
		log.Printf("demo bootstrap: %d agents already present — skipping seed", len(existing))
		return nil
	}
	log.Printf("demo bootstrap: tenant empty — running SeedNewTenant on DemoTenantID")
	if err := ledger.SeedNewTenant(ctx, pool, demoOrgID, ledger.DemoTenantID); err != nil {
		return fmt.Errorf("seed demo tenant: %w", err)
	}
	post, _ := ledger.ListAgents(ctx, pool, demoOrgID, ledger.DemoTenantID)
	log.Printf("demo bootstrap: seeded — %d agents now present", len(post))
	return nil
}
