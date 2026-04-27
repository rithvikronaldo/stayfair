package ledger

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// TestGetBalanceUnknownAccount asserts a query for an account that does not
// exist in the demo org returns ErrUnknownAccount.
func TestGetBalanceUnknownAccount(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)

	_, err := GetBalance(context.Background(), pool, orgID, "no_such_account")
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

	b, err := GetBalance(context.Background(), pool, orgID, "cash")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.Account != "cash" {
		t.Fatalf("Account: want cash, got %q", b.Account)
	}
	if b.Currency != "INR" {
		t.Fatalf("Currency: want INR, got %q", b.Currency)
	}
	t.Logf("cash balance = %d %s", b.Amount, b.Currency)
}
