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

// TestConvertBalance asserts that ConvertBalance correctly converts a balance
// from one currency to another using the FX rate at the same point in time.
func TestConvertBalance(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	// Use a known timestamp from the seed data: 2026-04-01 has USD→INR rate of 84.1
	asOf := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)

	// Create a balance in USD
	originalBalance := &Balance{
		Account:  "test_account",
		Currency: "USD",
		Amount:   10000, // $100.00
		AsOf:     &asOf,
	}

	// Convert to INR
	converted, err := ConvertBalance(ctx, pool, originalBalance, "INR")
	if err != nil {
		t.Fatalf("ConvertBalance() error = %v", err)
	}

	if converted.Currency != "INR" {
		t.Errorf("Currency: want INR, got %s", converted.Currency)
	}

	// At rate 84.1, $100.00 (10000 cents) should become ₹8410.00 (841000 paise)
	expected := int64(841000)
	if converted.Amount != expected {
		t.Errorf("Amount: want %d, got %d", expected, converted.Amount)
	}

	if converted.Account != originalBalance.Account {
		t.Errorf("Account: want %s, got %s", originalBalance.Account, converted.Account)
	}

	if converted.AsOf == nil || !converted.AsOf.Equal(*originalBalance.AsOf) {
		t.Errorf("AsOf: want %v, got %v", originalBalance.AsOf, converted.AsOf)
	}
}

// TestConvertBalanceSameCurrency asserts that converting to the same currency
// returns the original balance unchanged.
func TestConvertBalanceSameCurrency(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	originalBalance := &Balance{
		Account:  "test_account",
		Currency: "USD",
		Amount:   10000,
		AsOf:     nil,
	}

	converted, err := ConvertBalance(ctx, pool, originalBalance, "USD")
	if err != nil {
		t.Fatalf("ConvertBalance() error = %v", err)
	}

	if converted.Amount != originalBalance.Amount {
		t.Errorf("Amount: want %d, got %d", originalBalance.Amount, converted.Amount)
	}

	if converted.Currency != "USD" {
		t.Errorf("Currency: want USD, got %s", converted.Currency)
	}
}

// TestConvertBalanceNoRate asserts that converting with no available FX rate
// returns ErrNoRate.
func TestConvertBalanceNoRate(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	// Use a timestamp before any FX rates exist
	veryOld := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	originalBalance := &Balance{
		Account:  "test_account",
		Currency: "USD",
		Amount:   10000,
		AsOf:     &veryOld,
	}

	_, err := ConvertBalance(ctx, pool, originalBalance, "INR")
	if err == nil {
		t.Fatal("expected error for no FX rate, got nil")
	}
	if !errors.Is(err, ErrNoRate) {
		t.Fatalf("expected ErrNoRate, got %v", err)
	}
}
