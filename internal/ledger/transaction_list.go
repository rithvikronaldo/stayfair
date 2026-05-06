package ledger

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListTransactionsFilter narrows the transaction list. Zero value of any
// field means "no filter on this field".
type ListTransactionsFilter struct {
	AccountCode string     // include only transactions touching this account
	From        *time.Time // occurred_at >= From (inclusive)
	To          *time.Time // occurred_at <= To (inclusive)
	Limit       int        // max rows; clamped to [1, 200]; 50 if zero
	Cursor      string     // opaque pagination token from a previous response
}

// TransactionListItem is one row in the response. Includes all entries so the
// dashboard can render the full transaction without a follow-up call.
type TransactionListItem struct {
	ID          uuid.UUID     `json:"id"`
	Description string        `json:"description"`
	OccurredAt  time.Time     `json:"occurred_at"`
	CreatedAt   time.Time     `json:"created_at"`
	Entries     []PostedEntry `json:"entries"`
}

// TransactionListPage is a page of transactions plus an opaque cursor for the
// next page. NextCursor is empty when there are no more rows.
type TransactionListPage struct {
	Transactions []TransactionListItem `json:"transactions"`
	NextCursor   string                `json:"next_cursor,omitempty"`
}

// ListTransactions returns a page of transactions for the org, filtered and
// paginated by the given filter. Ordering is (occurred_at DESC, id DESC) —
// newest first, with a stable tie-breaker on id so cursor pagination doesn't
// duplicate or skip rows when timestamps collide.
func ListTransactions(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID uuid.UUID,
	f ListTransactionsFilter,
) (*TransactionListPage, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	var cursorOccurred time.Time
	var cursorID uuid.UUID
	hasCursor := false
	if f.Cursor != "" {
		var err error
		cursorOccurred, cursorID, err = decodeCursor(f.Cursor)
		if err != nil {
			return nil, fmt.Errorf("invalid cursor: %w", err)
		}
		hasCursor = true
	}

	var accountID uuid.UUID
	if f.AccountCode != "" {
		err := pool.QueryRow(ctx, `
			SELECT id FROM accounts WHERE org_id = $1 AND code = $2
		`, orgID, f.AccountCode).Scan(&accountID)
		if err != nil {
			return nil, fmt.Errorf("%w: %q", ErrUnknownAccount, f.AccountCode)
		}
	}

	// We fetch limit+1 rows to detect "is there another page?" without a
	// COUNT(*) — if we get back limit+1 rows, the (limit+1)th tells us the
	// page exists; we drop it from the response and use the limit-th row's
	// (occurred_at, id) as the next cursor.
	rows, err := pool.Query(ctx, `
		SELECT t.id, COALESCE(t.description, ''), t.occurred_at, t.created_at
		FROM transactions t
		WHERE t.org_id = $1
		  AND ($2::timestamptz IS NULL OR t.occurred_at >= $2)
		  AND ($3::timestamptz IS NULL OR t.occurred_at <= $3)
		  AND (
		    NOT $4
		    OR (t.occurred_at < $5)
		    OR (t.occurred_at = $5 AND t.id < $6)
		  )
		  AND (
		    $7::uuid IS NULL
		    OR EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = $7)
		  )
		ORDER BY t.occurred_at DESC, t.id DESC
		LIMIT $8
	`, orgID, f.From, f.To, hasCursor, cursorOccurred, cursorID, nullableUUID(accountID), limit+1)
	if err != nil {
		return nil, fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()

	page := &TransactionListPage{Transactions: make([]TransactionListItem, 0, limit)}
	type rowKey struct {
		id       uuid.UUID
		occurred time.Time
	}
	var keys []rowKey

	for rows.Next() {
		var item TransactionListItem
		if err := rows.Scan(&item.ID, &item.Description, &item.OccurredAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		page.Transactions = append(page.Transactions, item)
		keys = append(keys, rowKey{item.ID, item.OccurredAt})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	hasMore := len(page.Transactions) > limit
	if hasMore {
		page.Transactions = page.Transactions[:limit]
		keys = keys[:limit]
		last := keys[limit-1]
		page.NextCursor = encodeCursor(last.occurred, last.id)
	}

	if len(page.Transactions) == 0 {
		return page, nil
	}

	// Fetch entries for the transactions in this page in a single round-trip.
	ids := make([]uuid.UUID, 0, len(page.Transactions))
	idx := make(map[uuid.UUID]int, len(page.Transactions))
	for i, tx := range page.Transactions {
		ids = append(ids, tx.ID)
		idx[tx.ID] = i
	}

	// We pass the txn IDs as a text array literal joined into the SQL
	// because the simple query protocol (set in internal/db) can't
	// negotiate the array OID for a []uuid.UUID parameter. ids comes from
	// a trusted in-process source (uuid.UUID values we just scanned) — no
	// injection vector. UUIDs validate to a fixed shape.
	idLiteral := uuidArrayLiteral(ids)
	entryRows, err := pool.Query(ctx, `
		SELECT e.id, e.transaction_id, a.code, e.amount, e.currency, e.direction
		FROM entries e
		JOIN accounts a ON a.id = e.account_id
		WHERE e.transaction_id IN (`+idLiteral+`)
		ORDER BY e.created_at ASC, e.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query entries: %w", err)
	}
	defer entryRows.Close()

	for entryRows.Next() {
		var (
			entryID, txID uuid.UUID
			code          string
			amount        int64
			currency      string
			direction     string
		)
		if err := entryRows.Scan(&entryID, &txID, &code, &amount, &currency, &direction); err != nil {
			return nil, err
		}
		i, ok := idx[txID]
		if !ok {
			continue // shouldn't happen given the filter above
		}
		page.Transactions[i].Entries = append(page.Transactions[i].Entries, PostedEntry{
			ID:        entryID,
			Account:   code,
			Amount:    amount,
			Currency:  currency,
			Direction: Direction(direction),
		})
	}
	return page, entryRows.Err()
}

// nullableUUID returns nil for the zero UUID so a NULL parameter gets sent to
// pg, letting the SQL skip the filter via "$7 IS NULL".
func nullableUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// encodeCursor / decodeCursor pack (occurred_at, id) into an opaque string.
// Format: base64("<rfc3339nano>|<uuid>"). RFC3339Nano keeps full timestamp
// precision so the comparison in SQL is exact.
func encodeCursor(occurredAt time.Time, id uuid.UUID) string {
	raw := occurredAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// uuidArrayLiteral renders a slice of UUIDs as a SQL VALUES list:
//
//	'aaaa…'::uuid, 'bbbb…'::uuid, …
//
// Safe to embed in SQL because UUID has a fixed grammar and the source slice
// comes from a trusted in-process value. Used to work around the simple-
// query-protocol limitation on array parameter encoding.
func uuidArrayLiteral(ids []uuid.UUID) string {
	if len(ids) == 0 {
		// IN () is invalid SQL; caller should short-circuit before reaching
		// this. Return a never-matching literal as a defensive fallback.
		return "'00000000-0000-0000-0000-000000000000'::uuid"
	}
	var b strings.Builder
	b.Grow(len(ids) * 48)
	for i, id := range ids {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteByte('\'')
		b.WriteString(id.String())
		b.WriteString("'::uuid")
	}
	return b.String()
}

func decodeCursor(s string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, uuid.Nil, errors.New("not base64")
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, errors.New("missing separator")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("bad timestamp: %w", err)
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("bad uuid: %w", err)
	}
	return t, id, nil
}
