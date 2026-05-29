package ledger

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// makeTestTransactions captures `count` small transactions touching the given
// account (paired against guest_payments). Returns a cleanup func.
func makeTestTransactions(
	t *testing.T,
	pool *pgxpool.Pool,
	orgID uuid.UUID,
	accountCode string,
	count int,
) func() {
	t.Helper()
	ctx := context.Background()
	authIDs := make([]uuid.UUID, 0, count)
	txIDs := make([]uuid.UUID, 0, count)

	for i := range count {
		auth, err := Authorize(ctx, pool, orgID, DemoTenantID, accountCode, "guest_payments", 1, "INR", "list-test")
		if err != nil {
			t.Fatalf("authorize %d: %v", i, err)
		}
		authIDs = append(authIDs, auth.ID)
		posted, err := Capture(ctx, pool, DemoTenantID, auth.ID, 1)
		if err != nil {
			t.Fatalf("capture %d: %v", i, err)
		}
		txIDs = append(txIDs, posted.ID)
	}

	return func() {
		// Order matters: authorizations.transaction_id has an FK to
		// transactions, so kill that link first; then the entries; then
		// the transactions can finally be deleted without FK violations.
		for _, id := range authIDs {
			pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", id)
		}
		for _, id := range txIDs {
			pool.Exec(ctx, "DELETE FROM entries WHERE transaction_id = $1", id)
			pool.Exec(ctx, "DELETE FROM transactions WHERE id = $1", id)
		}
	}
}

// TestListTransactionsByAccount asserts the filter narrows to transactions
// touching a given account and returns them newest-first.
func TestListTransactionsByAccount(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	cleanup := makeTestTransactions(t, pool, orgID, "cash", 3)
	defer cleanup()

	page, err := ListTransactions(ctx, pool, orgID, DemoTenantID, ListTransactionsFilter{
		AccountCode: "cash",
		Limit:       5,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(page.Transactions) < 3 {
		t.Fatalf("want >=3 transactions touching cash, got %d", len(page.Transactions))
	}

	// Newest-first ordering.
	for i := 1; i < len(page.Transactions); i++ {
		if page.Transactions[i].OccurredAt.After(page.Transactions[i-1].OccurredAt) {
			t.Errorf("ordering broken at index %d: %v after %v",
				i, page.Transactions[i].OccurredAt, page.Transactions[i-1].OccurredAt)
		}
	}

	// Each item has its entries inlined.
	for i, tx := range page.Transactions {
		if len(tx.Entries) == 0 {
			t.Errorf("transaction %d (id=%s) has no entries", i, tx.ID)
		}
	}
}

// TestListTransactionsCursorPagination asserts a multi-page walk visits every
// transaction in the test set exactly once, no dupes, no gaps.
//
// Scoped to a freshly-spawned agent pair so the walk is bounded to this test's
// own data — running against a long-lived dev DB (with thousands of demo
// transactions on shared accounts like "cash") would otherwise blow past the
// safety cap even though the cursor itself is correct.
func TestListTransactionsCursorPagination(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	// Unique agent names so reruns against the same DB don't collide on
	// agents_tenant_id_name_key.
	suffix := uuid.New().String()[:8]
	srcAgent, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "cursor-src-"+suffix, "USD")
	if err != nil {
		t.Fatalf("spawn src: %v", err)
	}
	dstAgent, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "cursor-dst-"+suffix, "USD")
	if err != nil {
		t.Fatalf("spawn dst: %v", err)
	}
	defer func() {
		for _, id := range []uuid.UUID{srcAgent.ID, dstAgent.ID} {
			pool.Exec(ctx, "DELETE FROM accounts WHERE agent_id = $1", id)
			pool.Exec(ctx, "DELETE FROM agents WHERE id = $1", id)
		}
	}()

	const txCount = 7
	authIDs := make([]uuid.UUID, 0, txCount)
	txIDs := make([]uuid.UUID, 0, txCount)
	for i := range txCount {
		auth, err := Authorize(ctx, pool, orgID, DemoTenantID, srcAgent.AccountCode, dstAgent.AccountCode, 1, "USD", "cursor-test")
		if err != nil {
			t.Fatalf("authorize %d: %v", i, err)
		}
		authIDs = append(authIDs, auth.ID)
		posted, err := Capture(ctx, pool, DemoTenantID, auth.ID, 1)
		if err != nil {
			t.Fatalf("capture %d: %v", i, err)
		}
		txIDs = append(txIDs, posted.ID)
	}
	defer func() {
		for _, id := range authIDs {
			pool.Exec(ctx, "DELETE FROM authorizations WHERE id = $1", id)
		}
		for _, id := range txIDs {
			pool.Exec(ctx, "DELETE FROM entries WHERE transaction_id = $1", id)
			pool.Exec(ctx, "DELETE FROM transactions WHERE id = $1", id)
		}
	}()

	seen := make(map[uuid.UUID]bool)
	var pages int
	cursor := ""
	for {
		page, err := ListTransactions(ctx, pool, orgID, DemoTenantID, ListTransactionsFilter{
			AccountCode: srcAgent.AccountCode,
			Limit:       3,
			Cursor:      cursor,
		})
		if err != nil {
			t.Fatalf("page %d: %v", pages, err)
		}
		pages++
		for _, tx := range page.Transactions {
			if seen[tx.ID] {
				t.Errorf("duplicate transaction across pages: %s", tx.ID)
			}
			seen[tx.ID] = true
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
		if pages > 50 {
			t.Fatal("safety: pagination loop didn't terminate after 50 pages")
		}
	}

	if len(seen) != txCount {
		t.Errorf("expected exactly %d unique txns walked, got %d", txCount, len(seen))
	}
}

// TestListTransactionsTimeRange asserts From/To narrow correctly.
func TestListTransactionsTimeRange(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	veryOld := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	stillOld := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)

	page, err := ListTransactions(ctx, pool, orgID, DemoTenantID, ListTransactionsFilter{
		From: &veryOld,
		To:   &stillOld,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(page.Transactions) != 0 {
		t.Errorf("expected 0 transactions in 2000-2001 window, got %d", len(page.Transactions))
	}
}

// TestListTransactionsBadCursorRejected asserts garbage cursor returns error.
func TestListTransactionsBadCursorRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	for _, c := range []string{"!!!", "YWJj"} { // YWJj = "abc" base64'd, no separator
		_, err := ListTransactions(ctx, pool, orgID, DemoTenantID, ListTransactionsFilter{Cursor: c})
		if err == nil {
			t.Errorf("cursor=%q: expected error, got nil", c)
		}
	}
}

// TestListTransactionsLimitClamping asserts the limit is clamped to (1, 1000].
func TestListTransactionsLimitClamping(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	for _, lim := range []int{-1, 0, 1, 100, 500, 9999} {
		page, err := ListTransactions(ctx, pool, orgID, DemoTenantID, ListTransactionsFilter{Limit: lim})
		if err != nil {
			t.Fatalf("limit=%d: %v", lim, err)
		}
		if len(page.Transactions) > 1000 {
			t.Errorf("limit=%d: returned %d > 1000", lim, len(page.Transactions))
		}
	}
}

// TestListTransactionsCursorRoundTrip asserts encode→decode is lossless.
func TestListTransactionsCursorRoundTrip(t *testing.T) {
	now := time.Date(2026, 5, 6, 12, 34, 56, 789012345, time.UTC)
	id := uuid.MustParse("11111111-2222-3333-4444-555555555555")

	encoded := encodeCursor(now, id)
	gotTime, gotID, err := decodeCursor(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !gotTime.Equal(now) {
		t.Errorf("time round-trip: want %v, got %v", now, gotTime)
	}
	if gotID != id {
		t.Errorf("id round-trip: want %v, got %v", id, gotID)
	}
}

// TestListTransactionsUnknownAccountRejected asserts ErrUnknownAccount fires
// for a missing code.
func TestListTransactionsUnknownAccountRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	_, err := ListTransactions(ctx, pool, orgID, DemoTenantID, ListTransactionsFilter{
		AccountCode: "no_such_account",
	})
	if !errors.Is(err, ErrUnknownAccount) {
		t.Errorf("want ErrUnknownAccount, got %v", err)
	}
}
