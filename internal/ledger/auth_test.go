package ledger

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// Tests share the seed dataset and clean up the rows they write so the suite
// stays idempotent against re-runs.

// TestAuthorizeCreatesPendingAuth checks the happy path: a valid auth on two
// existing same-currency accounts produces a pending row with a default 7-day
// expiry.
func TestAuthorizeCreatesPendingAuth(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	auth, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", 1000, "INR", "test auth")
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	defer pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", auth.ID)

	if auth.Status != AuthPending {
		t.Errorf("status: want %q, got %q", AuthPending, auth.Status)
	}
	if auth.Amount != 1000 {
		t.Errorf("amount: want 1000, got %d", auth.Amount)
	}
	if auth.Currency != "INR" {
		t.Errorf("currency: want INR, got %s", auth.Currency)
	}
	if auth.ExpiresAt.Before(auth.CreatedAt) {
		t.Errorf("expires_at %v should be after created_at %v", auth.ExpiresAt, auth.CreatedAt)
	}
}

// TestCaptureFullAmount captures the full authorized amount and asserts the
// resulting transaction has two balanced entries (source out, dest in).
func TestCaptureFullAmount(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	auth, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", 1000, "INR", "capture full")
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}

	posted, err := Capture(ctx, pool, DemoTenantID, auth.ID, 1000)
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	defer func() {
		// authorizations.transaction_id FKs into transactions, so the auth
		// must be deleted (or its link nulled) before the transaction.
		pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", auth.ID)
		pool.Exec(ctx, "DELETE FROM entries WHERE transaction_id = $1", posted.ID)
		pool.Exec(ctx, "DELETE FROM transactions WHERE id = $1", posted.ID)
	}()

	if len(posted.Entries) != 2 {
		t.Fatalf("entries: want 2, got %d", len(posted.Entries))
	}
	var sourceLeg, destLeg *PostedEntry
	for i := range posted.Entries {
		switch posted.Entries[i].Account {
		case "cash":
			sourceLeg = &posted.Entries[i]
		case "guest_payments":
			destLeg = &posted.Entries[i]
		}
	}
	if sourceLeg == nil || sourceLeg.Direction != DirOut || sourceLeg.Amount != 1000 {
		t.Errorf("source leg wrong: %+v", sourceLeg)
	}
	if destLeg == nil || destLeg.Direction != DirIn || destLeg.Amount != 1000 {
		t.Errorf("dest leg wrong: %+v", destLeg)
	}

	// Auth should now be captured.
	var status AuthStatus
	var capturedAmount int64
	err = pool.QueryRow(ctx, `
		SELECT status, COALESCE(captured_amount, 0) FROM authorizations WHERE id = $1
	`, auth.ID).Scan(&status, &capturedAmount)
	if err != nil {
		t.Fatalf("auth status check: %v", err)
	}
	if status != AuthCaptured {
		t.Errorf("status after capture: want %s, got %s", AuthCaptured, status)
	}
	if capturedAmount != 1000 {
		t.Errorf("captured_amount: want 1000, got %d", capturedAmount)
	}
}

// TestCapturePartialAmount captures less than the authorized amount. Only the
// captured amount lands as entries; the remainder is implicitly released.
func TestCapturePartialAmount(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	auth, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", 1000, "INR", "capture partial")
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}

	posted, err := Capture(ctx, pool, DemoTenantID, auth.ID, 700)
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	defer func() {
		// authorizations.transaction_id FKs into transactions, so the auth
		// must be deleted (or its link nulled) before the transaction.
		pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", auth.ID)
		pool.Exec(ctx, "DELETE FROM entries WHERE transaction_id = $1", posted.ID)
		pool.Exec(ctx, "DELETE FROM transactions WHERE id = $1", posted.ID)
	}()

	for _, e := range posted.Entries {
		if e.Amount != 700 {
			t.Errorf("entry amount: want 700, got %d", e.Amount)
		}
	}
}

// TestCaptureExceedsAuthRejected attempts to capture more than authorized;
// must fail with ErrCaptureExceedsAuth without writing any entries.
func TestCaptureExceedsAuthRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	auth, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", 500, "INR", "exceed test")
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	defer pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", auth.ID)

	_, err = Capture(ctx, pool, DemoTenantID, auth.ID, 600)
	if !errors.Is(err, ErrCaptureExceedsAuth) {
		t.Fatalf("expected ErrCaptureExceedsAuth, got %v", err)
	}

	// Auth must still be pending, no transaction written.
	var status AuthStatus
	pool.QueryRow(ctx, `SELECT status FROM authorizations WHERE id = $1`, auth.ID).Scan(&status)
	if status != AuthPending {
		t.Errorf("status after failed capture: want pending, got %s", status)
	}
}

// TestVoidPending voids a pending auth and asserts the status flips. A second
// void on the same auth must fail with ErrAuthNotPending.
func TestVoidPending(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	auth, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", 500, "INR", "void me")
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	defer pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", auth.ID)

	if err := Void(ctx, pool, DemoTenantID, auth.ID); err != nil {
		t.Fatalf("first void: %v", err)
	}

	var status AuthStatus
	pool.QueryRow(ctx, `SELECT status FROM authorizations WHERE id = $1`, auth.ID).Scan(&status)
	if status != AuthVoided {
		t.Errorf("status after void: want %s, got %s", AuthVoided, status)
	}

	if err := Void(ctx, pool, DemoTenantID, auth.ID); !errors.Is(err, ErrAuthNotPending) {
		t.Errorf("second void: want ErrAuthNotPending, got %v", err)
	}
}

// TestVoidAfterCaptureRejected ensures Void won't undo a captured auth.
func TestVoidAfterCaptureRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	auth, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", 500, "INR", "no void after capture")
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	posted, err := Capture(ctx, pool, DemoTenantID, auth.ID, 500)
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	defer func() {
		// authorizations.transaction_id FKs into transactions, so the auth
		// must be deleted (or its link nulled) before the transaction.
		pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", auth.ID)
		pool.Exec(ctx, "DELETE FROM entries WHERE transaction_id = $1", posted.ID)
		pool.Exec(ctx, "DELETE FROM transactions WHERE id = $1", posted.ID)
	}()

	err = Void(ctx, pool, DemoTenantID, auth.ID)
	if !errors.Is(err, ErrAuthNotPending) {
		t.Errorf("void after capture: want ErrAuthNotPending, got %v", err)
	}
}

// TestVoidUnknownAuthReturnsErrAuthNotFound asserts a void on a random UUID
// returns ErrAuthNotFound, not a generic error.
func TestVoidUnknownAuthReturnsErrAuthNotFound(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	err := Void(ctx, pool, DemoTenantID, uuid.New())
	if !errors.Is(err, ErrAuthNotFound) {
		t.Errorf("expected ErrAuthNotFound, got %v", err)
	}
}

// TestAuthorizeUnknownAccountReturnsErrUnknownAccount asserts a missing source
// returns ErrUnknownAccount with the account code in the wrap chain.
func TestAuthorizeUnknownAccountReturnsErrUnknownAccount(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	_, err := Authorize(ctx, pool, orgID, DemoTenantID, "no_such_account", "guest_payments", 1000, "INR", "")
	if !errors.Is(err, ErrUnknownAccount) {
		t.Errorf("expected ErrUnknownAccount, got %v", err)
	}
}

// TestAuthorizeCurrencyMismatch asserts requesting a currency that doesn't
// match the source/destination accounts is rejected. Demo accounts are all
// INR; passing USD must fail.
func TestAuthorizeCurrencyMismatch(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	_, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", 1000, "USD", "wrong currency")
	if !errors.Is(err, ErrCurrencyMismatch) {
		t.Errorf("expected ErrCurrencyMismatch, got %v", err)
	}
}

// TestAuthorizeNonPositiveAmountRejected asserts a 0 or negative authorize
// amount errors out before touching the database.
func TestAuthorizeNonPositiveAmountRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	for _, amount := range []int64{0, -1, -1000} {
		if _, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "guest_payments", amount, "INR", ""); err == nil {
			t.Errorf("amount=%d: expected error, got nil", amount)
		}
	}
}

// TestAuthorizeSameSourceAndDestRejected asserts the source/dest equality
// check fires before the DB.
func TestAuthorizeSameSourceAndDestRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	if _, err := Authorize(ctx, pool, orgID, DemoTenantID, "cash", "cash", 1000, "INR", ""); err == nil {
		t.Error("expected error for source==dest, got nil")
	}
}
