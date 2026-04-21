package ledger

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrUnknownAccount is returned when an entry references an account code
// that doesn't exist for the given org.
var ErrUnknownAccount = errors.New("ledger: unknown account code")

// PostedEntry is an entry after it has been written to the database —
// same fields as Entry plus the DB-generated ID.
type PostedEntry struct {
	ID        uuid.UUID `json:"id"`
	Account   string    `json:"account"`
	Amount    int64     `json:"amount"`
	Currency  string    `json:"currency"`
	Direction Direction `json:"direction"`
}

// PostedTransaction is a transaction after it has been saved, with all
// the IDs and timestamps the database assigned.
type PostedTransaction struct {
	ID          uuid.UUID     `json:"id"`
	Description string        `json:"description"`
	OccurredAt  time.Time     `json:"occurred_at"`
	CreatedAt   time.Time     `json:"created_at"`
	Entries     []PostedEntry `json:"entries"`
}

// Post validates a transaction, writes it atomically along with its entries,
// and returns the persisted result. All entries must be balanced per currency
// (CheckBalanced). If any step fails the whole write is rolled back.
func Post(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, t Transaction) (*PostedTransaction, error) {
	if err := CheckBalanced(t.Entries); err != nil {
		return nil, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin db tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op if we reach Commit; safety net otherwise

	codes := make([]string, 0, len(t.Entries))
	for _, e := range t.Entries {
		codes = append(codes, e.Account)
	}
	accountIDs, err := resolveAccounts(ctx, tx, orgID, codes)
	if err != nil {
		return nil, err
	}

	var txID uuid.UUID
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (org_id, description, occurred_at)
		VALUES ($1, $2, $3)
		RETURNING id, created_at
	`, orgID, t.Description, t.OccurredAt).Scan(&txID, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("insert transaction: %w", err)
	}

	posted := make([]PostedEntry, 0, len(t.Entries))
	for _, e := range t.Entries {
		var entryID uuid.UUID
		err = tx.QueryRow(ctx, `
			INSERT INTO entries (transaction_id, account_id, amount, currency, direction)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id
		`, txID, accountIDs[e.Account], e.Amount, e.Currency, string(e.Direction)).Scan(&entryID)
		if err != nil {
			return nil, fmt.Errorf("insert entry %s: %w", e.Account, err)
		}
		posted = append(posted, PostedEntry{
			ID:        entryID,
			Account:   e.Account,
			Amount:    e.Amount,
			Currency:  e.Currency,
			Direction: e.Direction,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &PostedTransaction{
		ID:          txID,
		Description: t.Description,
		OccurredAt:  t.OccurredAt,
		CreatedAt:   createdAt,
		Entries:     posted,
	}, nil
}

// resolveAccounts looks up account IDs by their (org, code) pair. Returns
// ErrUnknownAccount if any requested code doesn't exist for the org.
func resolveAccounts(ctx context.Context, tx pgx.Tx, orgID uuid.UUID, codes []string) (map[string]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		SELECT code, id FROM accounts WHERE org_id = $1 AND code = ANY($2)
	`, orgID, codes)
	if err != nil {
		return nil, fmt.Errorf("query accounts: %w", err)
	}
	defer rows.Close()

	result := make(map[string]uuid.UUID, len(codes))
	for rows.Next() {
		var code string
		var id uuid.UUID
		if err := rows.Scan(&code, &id); err != nil {
			return nil, err
		}
		result[code] = id
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, c := range codes {
		if _, ok := result[c]; !ok {
			return nil, fmt.Errorf("%w: %q", ErrUnknownAccount, c)
		}
	}
	return result, nil
}
