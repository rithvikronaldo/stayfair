package ledger

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestCrossTenantIsolation proves the tenant_id predicate on ListAgents
// blocks cross-tenant reads. The same predicate is on every WHERE clause
// that touches a scoped table — if it works here, it works everywhere.
//
// Setup: tenant A is the seed demo tenant (already has agents from
// migration 007's backfill). Tenant B is created fresh and has zero
// rows. Both share demoOrgID, so the org_id predicate doesn't filter
// for us — only tenant_id does. That's the predicate under test.
func TestCrossTenantIsolation(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	// Tenant A: the seeded demo tenant.
	tenantA := DemoTenantID

	// Tenant B: fresh, no rows under it yet.
	tenantB, _, err := CreateTenant(
		ctx, pool,
		fmt.Sprintf("test-%d@example.com", time.Now().UnixNano()),
		"Cross-Tenant Test",
	)
	if err != nil {
		t.Fatalf("create tenant B: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM tenants WHERE id = $1`, tenantB.ID)
	})

	orgID := uuid.MustParse(demoOrgID)

	// Tenant A should see its demo agents.
	agentsA, err := ListAgents(ctx, pool, orgID, tenantA)
	if err != nil {
		t.Fatalf("list agents under tenant A: %v", err)
	}
	if len(agentsA) == 0 {
		t.Fatal("expected demo tenant to have agents (seeded by migration 007)")
	}
	t.Logf("tenant A: %d agents visible", len(agentsA))

	// Tenant B must see zero — same org_id, different tenant_id.
	agentsB, err := ListAgents(ctx, pool, orgID, tenantB.ID)
	if err != nil {
		t.Fatalf("list agents under tenant B: %v", err)
	}
	if len(agentsB) != 0 {
		t.Fatalf("cross-tenant leak: tenant B sees %d of tenant A's agents",
			len(agentsB))
	}
	t.Logf("tenant B: 0 agents visible (isolation holds)")
}

// TestCaptureCrossTenantRejected proves the Capture security fix —
// trying to capture another tenant's pending auth returns ErrAuthNotFound,
// not a successful capture. This is the bug the migration surfaced.
func TestCaptureCrossTenantRejected(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	orgID := uuid.MustParse(demoOrgID)

	// Authorize under tenant A.
	auth, err := Authorize(
		ctx, pool, orgID, DemoTenantID,
		"cash", "guest_payments", 100, "INR", "cross-tenant capture test",
	)
	if err != nil {
		t.Fatalf("authorize under A: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM authorizations WHERE id = $1`, auth.ID)
	})

	// Create tenant B.
	tenantB, _, err := CreateTenant(
		ctx, pool,
		fmt.Sprintf("test-cap-%d@example.com", time.Now().UnixNano()),
		"Cross-Tenant Capture Test",
	)
	if err != nil {
		t.Fatalf("create tenant B: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM tenants WHERE id = $1`, tenantB.ID)
	})

	// Tenant B attempts to capture tenant A's auth by guessing the id.
	_, err = Capture(ctx, pool, tenantB.ID, auth.ID, 50)
	if err == nil {
		t.Fatal("cross-tenant capture succeeded — tenant_id predicate is missing")
	}
	if !errors.Is(err, ErrAuthNotFound) {
		t.Fatalf("expected ErrAuthNotFound, got %v", err)
	}
	t.Logf("cross-tenant capture correctly rejected: %v", err)
}

// TestAuthorizeCrossTenantRejected proves Authorize can't be invoked by
// tenant B against tenant A's account codes. The predicate fires in
// resolveAccountCurrency before any INSERT happens.
func TestAuthorizeCrossTenantRejected(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	orgID := uuid.MustParse(demoOrgID)

	tenantB, _, err := CreateTenant(
		ctx, pool,
		fmt.Sprintf("test-auth-%d@example.com", time.Now().UnixNano()),
		"Cross-Tenant Authorize Test",
	)
	if err != nil {
		t.Fatalf("create tenant B: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM tenants WHERE id = $1`, tenantB.ID)
	})

	// Tenant B tries to Authorize against demo tenant's seeded accounts
	// ("cash" / "guest_payments"). Both exist in the DB — but not under
	// tenant B's scope. The predicate in resolveAccountCurrency returns
	// ErrUnknownAccount.
	_, err = Authorize(
		ctx, pool, orgID, tenantB.ID,
		"cash", "guest_payments", 100, "INR", "cross-tenant authorize",
	)
	if err == nil {
		t.Fatal("cross-tenant authorize succeeded — tenant_id predicate missing on accounts lookup")
	}
	if !errors.Is(err, ErrUnknownAccount) {
		t.Fatalf("expected ErrUnknownAccount, got %v", err)
	}
	t.Logf("cross-tenant authorize correctly rejected: %v", err)
}

// TestVoidCrossTenantRejected proves Void filters by tenant_id like
// Capture does — guessing the auth UUID from another tenant fails.
func TestVoidCrossTenantRejected(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	orgID := uuid.MustParse(demoOrgID)

	// Authorize under tenant A.
	auth, err := Authorize(
		ctx, pool, orgID, DemoTenantID,
		"cash", "guest_payments", 100, "INR", "cross-tenant void test",
	)
	if err != nil {
		t.Fatalf("authorize under A: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM authorizations WHERE id = $1`, auth.ID)
	})

	tenantB, _, err := CreateTenant(
		ctx, pool,
		fmt.Sprintf("test-void-%d@example.com", time.Now().UnixNano()),
		"Cross-Tenant Void Test",
	)
	if err != nil {
		t.Fatalf("create tenant B: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM tenants WHERE id = $1`, tenantB.ID)
	})

	err = Void(ctx, pool, tenantB.ID, auth.ID)
	if err == nil {
		t.Fatal("cross-tenant void succeeded — tenant_id predicate missing")
	}
	if !errors.Is(err, ErrAuthNotFound) {
		t.Fatalf("expected ErrAuthNotFound, got %v", err)
	}

	// Confirm the auth is still pending — the failed void didn't mutate it.
	var status AuthStatus
	if err := pool.QueryRow(ctx,
		`SELECT status FROM authorizations WHERE id = $1`, auth.ID,
	).Scan(&status); err != nil {
		t.Fatalf("status check: %v", err)
	}
	if status != AuthPending {
		t.Fatalf("auth status changed by cross-tenant void: %s", status)
	}
	t.Logf("cross-tenant void correctly rejected; auth still %s", status)
}

// TestGetBalanceCrossTenantRejected proves the read path is also scoped.
// The accounts WHERE clause filters by (org_id, tenant_id, code) so a
// lookup against another tenant's account code returns ErrUnknownAccount.
func TestGetBalanceCrossTenantRejected(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	orgID := uuid.MustParse(demoOrgID)

	tenantB, _, err := CreateTenant(
		ctx, pool,
		fmt.Sprintf("test-bal-%d@example.com", time.Now().UnixNano()),
		"Cross-Tenant Balance Test",
	)
	if err != nil {
		t.Fatalf("create tenant B: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM tenants WHERE id = $1`, tenantB.ID)
	})

	// Demo tenant has a "cash" account. Tenant B does not.
	_, err = GetBalance(ctx, pool, orgID, tenantB.ID, "cash", nil)
	if err == nil {
		t.Fatal("cross-tenant balance read succeeded — tenant_id predicate missing on accounts lookup")
	}
	if !errors.Is(err, ErrUnknownAccount) {
		t.Fatalf("expected ErrUnknownAccount, got %v", err)
	}
	t.Logf("cross-tenant balance read correctly rejected: %v", err)
}
