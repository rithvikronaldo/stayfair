package ledger

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestGetBalanceUnknownAccount asserts a query for an account that does not
// exist in the demo org returns ErrUnknownAccount.
func TestGetBalanceUnknownAccount(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)

	_, err := GetBalance(context.Background(), pool, orgID, "no_such_account", nil)
	if err == nil {
		t.Fatal("expected error for unknown account, got nil")
	}
	if !errors.Is(err, ErrUnknownAccount) {
		t.Fatalf("expected ErrUnknownAccount, got %v", err)
	}
}

// TestGetBalanceKnownAccountReturnsCurrency asserts a query for an existing
// account returns the account's declared currency. Balance value is not
// asserted (depends on what other tests/transactions have run).
func TestGetBalanceKnownAccountReturnsCurrency(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)

	b, err := GetBalance(context.Background(), pool, orgID, "cash", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.Account != "cash" {
		t.Fatalf("Account: want cash, got %q", b.Account)
	}
	if b.Currency != "INR" {
		t.Fatalf("Currency: want INR, got %q", b.Currency)
	}
	if b.AsOf != nil {
		t.Fatalf("AsOf: want nil for current-balance query, got %v", b.AsOf)
	}
	t.Logf("cash balance = %d %s", b.Amount, b.Currency)
}

// TestGetBalancePointInTime asserts that an as_of timestamp earlier than any
// transaction returns 0, and that an as_of in the far future returns the same
// balance as a current-balance query. Robust against whatever data is in the
// DB — does not depend on specific known transactions.
func TestGetBalancePointInTime(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	// Far in the past — before any conceivable transaction.
	veryOld := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	bOld, err := GetBalance(ctx, pool, orgID, "guest_payments", &veryOld)
	if err != nil {
		t.Fatalf("old query: %v", err)
	}
	if bOld.Amount != 0 {
		t.Fatalf("balance as_of 2000-01-01 should be 0, got %d", bOld.Amount)
	}
	if bOld.AsOf == nil || !bOld.AsOf.Equal(veryOld) {
		t.Fatalf("AsOf in response should round-trip the input timestamp")
	}

	// Far future — should match the current-balance query.
	veryFuture := time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC)
	bFuture, err := GetBalance(ctx, pool, orgID, "guest_payments", &veryFuture)
	if err != nil {
		t.Fatalf("future query: %v", err)
	}

	bNow, err := GetBalance(ctx, pool, orgID, "guest_payments", nil)
	if err != nil {
		t.Fatalf("current query: %v", err)
	}

	if bFuture.Amount != bNow.Amount {
		t.Fatalf("future as_of should equal current balance: future=%d, now=%d",
			bFuture.Amount, bNow.Amount)
	}

	t.Logf("guest_payments: as_of 2000=%d, current=%d, as_of 2099=%d",
		bOld.Amount, bNow.Amount, bFuture.Amount)
}
