package ledger

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests prove the Postgres AFTER INSERT DEFERRABLE constraint trigger
// from migration 002 enforces Σ in = Σ out per currency even when entries
// are written with raw SQL that bypasses internal/ledger/repo.go.
//
// They require a running Postgres with migrations applied and the seed
// fixtures loaded. Set TEST_DB_URL to opt in; otherwise the tests are
// skipped so `go test ./...` stays fast.

const demoOrgID = "00000000-0000-0000-0000-000000000001"

func openTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("TEST_DB_URL")
	if dbURL == "" {
		t.Skip("TEST_DB_URL not set; skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func lookupAccountID(t *testing.T, pool *pgxpool.Pool, code string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		SELECT id FROM accounts WHERE org_id = $1 AND code = $2
	`, demoOrgID, code).Scan(&id)
	if err != nil {
		t.Fatalf("lookup account %s: %v", code, err)
	}
	return id
}

// TestTriggerRejectsUnbalancedRawInsert inserts 100 IN and 50 OUT — clearly
// unbalanced — via raw SQL and asserts the COMMIT fails with the trigger's
// ENTRIES_UNBALANCED exception. This is the proof the DB-level check works
// even when app code is bypassed.
func TestTriggerRejectsUnbalancedRawInsert(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	accountID := lookupAccountID(t, pool, "cash")

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	var txID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (org_id, description, occurred_at)
		VALUES ($1, $2, $3)
		RETURNING id
	`, demoOrgID, "DELIBERATELY UNBALANCED (test)", time.Now()).Scan(&txID)
	if err != nil {
		t.Fatalf("insert tx: %v", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO entries (transaction_id, account_id, amount, currency, direction)
		VALUES ($1, $2, 100, 'INR', 'in'),
		       ($1, $2,  50, 'INR', 'out')
	`, txID, accountID)
	if err != nil {
		t.Fatalf("insert entries failed before commit — unexpected because trigger is DEFERRED: %v", err)
	}

	err = tx.Commit(ctx)
	if err == nil {
		t.Fatal("expected COMMIT to fail with ENTRIES_UNBALANCED, but it succeeded — trigger is not enforcing")
	}
	if !strings.Contains(err.Error(), "ENTRIES_UNBALANCED") {
		t.Fatalf("expected ENTRIES_UNBALANCED in error, got: %v", err)
	}
	t.Logf("trigger correctly rejected commit: %v", err)
}

// TestTriggerAllowsBalancedRawInsert is the inverse: 100 IN and 100 OUT
// balance cleanly, so COMMIT must succeed.
func TestTriggerAllowsBalancedRawInsert(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	accountID := lookupAccountID(t, pool, "cash")

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	// Always roll back after the assertion so test data doesn't pollute the DB.
	defer tx.Rollback(ctx)

	var txID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (org_id, description, occurred_at)
		VALUES ($1, $2, $3)
		RETURNING id
	`, demoOrgID, "BALANCED (test)", time.Now()).Scan(&txID)
	if err != nil {
		t.Fatalf("insert tx: %v", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO entries (transaction_id, account_id, amount, currency, direction)
		VALUES ($1, $2, 100, 'INR', 'in'),
		       ($1, $2, 100, 'INR', 'out')
	`, txID, accountID)
	if err != nil {
		t.Fatalf("insert entries: %v", err)
	}

	// Verify the deferred trigger check passes at commit time.
	// Use SET CONSTRAINTS IMMEDIATE to force the check to run here, while
	// the transaction is still open, so we can assert without actually
	// committing and polluting the DB.
	_, err = tx.Exec(ctx, `SET CONSTRAINTS ALL IMMEDIATE`)
	if err != nil {
		t.Fatalf("balanced entries rejected by trigger unexpectedly: %v", err)
	}
	t.Logf("trigger correctly accepted balanced entries")
}

// TestTriggerRejectsUnbalancedMultiCurrency verifies the per-currency scoping:
// a transaction can balance in one currency but be off in another.
func TestTriggerRejectsUnbalancedMultiCurrency(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	cashINR := lookupAccountID(t, pool, "cash")

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	var txID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (org_id, description, occurred_at)
		VALUES ($1, $2, $3)
		RETURNING id
	`, demoOrgID, "Multi-currency imbalance (test)", time.Now()).Scan(&txID)
	if err != nil {
		t.Fatalf("insert tx: %v", err)
	}

	// INR balances (500 in / 500 out), USD does NOT (10 in / 9 out).
	// The trigger should still reject the whole transaction.
	_, err = tx.Exec(ctx, `
		INSERT INTO entries (transaction_id, account_id, amount, currency, direction)
		VALUES ($1, $2, 500, 'INR', 'in'),
		       ($1, $2, 500, 'INR', 'out'),
		       ($1, $2,  10, 'USD', 'in'),
		       ($1, $2,   9, 'USD', 'out')
	`, txID, cashINR)
	if err != nil {
		t.Fatalf("insert entries: %v", err)
	}

	err = tx.Commit(ctx)
	if err == nil {
		t.Fatal("expected COMMIT to fail (USD unbalanced), but it succeeded")
	}
	if !strings.Contains(err.Error(), "ENTRIES_UNBALANCED") || !strings.Contains(err.Error(), "USD") {
		t.Fatalf("expected USD imbalance in error, got: %v", err)
	}
	t.Logf("trigger correctly flagged USD imbalance: %v", err)
}
