package ledger

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AgentStatus mirrors the agent_status enum in migrations/005.
type AgentStatus string

const (
	AgentActive AgentStatus = "active"
	AgentPaused AgentStatus = "paused"
	AgentKilled AgentStatus = "killed"
)

// Agent is the public shape of an agent, including its primary account code
// (the only ledger account that gets created when the agent is spawned). For
// agents that later transact in additional currencies, more accounts can be
// linked to the same agent_id — but for the demo simulator, one currency per
// agent is the contract.
type Agent struct {
	ID          uuid.UUID   `json:"id"`
	Name        string      `json:"name"`
	Status      AgentStatus `json:"status"`
	Currency    string      `json:"currency"`
	AccountCode string      `json:"account_code"`
	CreatedAt   time.Time   `json:"created_at"`
}

var (
	ErrAgentNotFound  = errors.New("ledger: agent not found")
	ErrAgentExists    = errors.New("ledger: agent name already exists")
	ErrUnknownCurrency = errors.New("ledger: unknown currency")
)

// SpawnAgent creates an agent and an asset-type account for it, atomically.
// The account code is derived from the agent's UUID: agent_<8-char>_<currency>.
// Returns ErrAgentExists if (tenantID, name) already exists. Both the agent
// row and the account row land under tenantID.
func SpawnAgent(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, tenantID uuid.UUID,
	name, currency string,
) (*Agent, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("ledger: agent name is required")
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		return nil, fmt.Errorf("ledger: currency is required")
	}

	// Validate currency exists.
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT true FROM currencies WHERE code = $1
	`, currency).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: %q", ErrUnknownCurrency, currency)
	}
	if err != nil {
		return nil, fmt.Errorf("currency lookup: %w", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var agent Agent
	agent.Name = name
	agent.Currency = currency
	err = tx.QueryRow(ctx, `
		INSERT INTO agents (org_id, tenant_id, name) VALUES ($1, $2, $3)
		RETURNING id, status, created_at
	`, orgID, tenantID, name).Scan(&agent.ID, &agent.Status, &agent.CreatedAt)
	if err != nil {
		// 23505 is unique_violation
		if strings.Contains(err.Error(), "agents_tenant_id_name_key") {
			return nil, fmt.Errorf("%w: %q", ErrAgentExists, name)
		}
		return nil, fmt.Errorf("insert agent: %w", err)
	}

	agent.AccountCode = fmt.Sprintf("agent_%s_%s",
		strings.ReplaceAll(agent.ID.String()[:8], "-", ""),
		strings.ToLower(currency),
	)

	_, err = tx.Exec(ctx, `
		INSERT INTO accounts (org_id, tenant_id, code, name, type, currency, agent_id)
		VALUES ($1, $2, $3, $4, 'asset', $5, $6)
	`, orgID, tenantID, agent.AccountCode, name+" wallet ("+currency+")", currency, agent.ID)
	if err != nil {
		return nil, fmt.Errorf("insert agent account: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return &agent, nil
}

// AgentSummary is the agent with its primary account's current balance (in the
// agent's native currency, the realised amount only — pending authorizations
// are not netted here). Used by GET /agents.
type AgentSummary struct {
	Agent
	Balance int64 `json:"balance"`
}

// ListAgents returns every agent for the tenant with its primary account's
// current balance. Newest agent first.
func ListAgents(ctx context.Context, pool *pgxpool.Pool, orgID, tenantID uuid.UUID) ([]AgentSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			ag.id, ag.name, ag.status, ag.created_at,
			a.code, a.currency,
			COALESCE((
				SELECT SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END)
				FROM entries e WHERE e.account_id = a.id
			), 0)
		FROM agents ag
		JOIN accounts a ON a.agent_id = ag.id
		WHERE ag.org_id = $1 AND ag.tenant_id = $2
		ORDER BY ag.created_at DESC, a.code ASC
	`, orgID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list agents: %w", err)
	}
	defer rows.Close()

	out := make([]AgentSummary, 0, 8)
	for rows.Next() {
		var s AgentSummary
		if err := rows.Scan(
			&s.ID, &s.Name, &s.Status, &s.CreatedAt,
			&s.AccountCode, &s.Currency, &s.Balance,
		); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetAgent returns one agent by id (within the tenant + org).
func GetAgent(ctx context.Context, pool *pgxpool.Pool, orgID, tenantID, agentID uuid.UUID) (*Agent, error) {
	var a Agent
	err := pool.QueryRow(ctx, `
		SELECT
			ag.id, ag.name, ag.status, ag.created_at,
			acc.code, acc.currency
		FROM agents ag
		JOIN accounts acc ON acc.agent_id = ag.id
		WHERE ag.id = $1 AND ag.org_id = $2 AND ag.tenant_id = $3
		LIMIT 1
	`, agentID, orgID, tenantID).Scan(
		&a.ID, &a.Name, &a.Status, &a.CreatedAt, &a.AccountCode, &a.Currency,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAgentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get agent: %w", err)
	}
	return &a, nil
}

// SetAgentStatus flips an agent's status (typically active → killed). Returns
// ErrAgentNotFound if the agent doesn't exist within the tenant + org.
func SetAgentStatus(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, tenantID, agentID uuid.UUID,
	status AgentStatus,
) error {
	tag, err := pool.Exec(ctx, `
		UPDATE agents SET status = $4
		WHERE id = $1 AND org_id = $2 AND tenant_id = $3
	`, agentID, orgID, tenantID, status)
	if err != nil {
		return fmt.Errorf("update agent status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrAgentNotFound
	}
	return nil
}
