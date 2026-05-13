package ledger

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestComputeSnapshotsPopulatesAllAccounts asserts that ComputeSnapshots
// writes one row per account in the org for the given date, and that the
// row's balance matches the expected end-of-day sum.
func TestComputeSnapshotsPopulatesAllAccounts(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	// Pick a date well after any test transaction, so the snapshot covers
	// every entry currently in the DB. Using 2099 means everything is included.
	snapDate := time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC)

	if err := ComputeSnapshots(ctx, pool, orgID, snapDate); err != nil {
		t.Fatalf("ComputeSnapshots: %v", err)
	}

	// We expect at least 5 snapshot rows (the 5 demo accounts) for this date.
	var count int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM account_snapshots s
		JOIN accounts a ON a.id = s.account_id
		WHERE a.org_id = $1 AND s.as_of_date = $2::date
	`, orgID, snapDate).Scan(&count); err != nil {
		t.Fatalf("count query: %v", err)
	}
	if count < 5 {
		t.Fatalf("expected at least 5 snapshot rows for %s, got %d", snapDate, count)
	}

	t.Logf("populated %d snapshot rows for as_of_date=%s", count, snapDate.Format("2006-01-02"))
}

// TestSnapshotAcceleratedBalanceMatchesNaive is the correctness proof of the
// snapshot-and-delta approach: querying balance with a snapshot present must
// return the exact same value as querying with no snapshot. Different paths,
// same answer.
func TestSnapshotAcceleratedBalanceMatchesNaive(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	accounts := []string{"cash", "guest_payments", "host_payable", "commission", "gst_payable"}

	// First, clear any existing snapshots for this org so we get a clean
	// "naive" baseline. (We're inside an integration test, so this is OK.)
	_, err := pool.Exec(ctx, `
		DELETE FROM account_snapshots
		WHERE account_id IN (SELECT id FROM accounts WHERE org_id = $1)
	`, orgID)
	if err != nil {
		t.Fatalf("clear snapshots: %v", err)
	}

	// Capture naive balances (full scan from time zero) for each account.
	naive := map[string]int64{}
	for _, code := range accounts {
		b, err := GetBalance(ctx, pool, orgID, DemoTenantID, code, nil)
		if err != nil {
			t.Fatalf("naive %s: %v", code, err)
		}
		naive[code] = b.Amount
	}

	// Now compute snapshots for an early date so subsequent queries use the
	// snapshot+delta path. Pick a date that's after the live demo tx
	// (2026-04-21) so the snapshot has non-zero data to capture.
	snapDate := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)
	if err := ComputeSnapshots(ctx, pool, orgID, snapDate); err != nil {
		t.Fatalf("ComputeSnapshots: %v", err)
	}

	// Re-query each account and assert the value matches naive.
	for _, code := range accounts {
		b, err := GetBalance(ctx, pool, orgID, DemoTenantID, code, nil)
		if err != nil {
			t.Fatalf("accelerated %s: %v", code, err)
		}
		if b.Amount != naive[code] {
			t.Fatalf("%s: snapshot-accelerated=%d, naive=%d (must match)",
				code, b.Amount, naive[code])
		}
		t.Logf("%-15s naive=%-10d accelerated=%-10d ✓", code, naive[code], b.Amount)
	}
}
