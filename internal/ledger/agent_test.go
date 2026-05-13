package ledger

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestSpawnAgentCreatesAgentAndAccount asserts a successful spawn produces an
// agent row and a linked account, both in the same transaction.
func TestSpawnAgentCreatesAgentAndAccount(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	a, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "test-spawn-1", "USD")
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	defer func() {
		pool.Exec(ctx, "DELETE FROM accounts WHERE agent_id = $1", a.ID)
		pool.Exec(ctx, "DELETE FROM agents WHERE id = $1", a.ID)
	}()

	if a.Status != AgentActive {
		t.Errorf("status: want %s, got %s", AgentActive, a.Status)
	}
	if a.Currency != "USD" {
		t.Errorf("currency: want USD, got %s", a.Currency)
	}
	if !strings.HasPrefix(a.AccountCode, "agent_") {
		t.Errorf("account code should start with agent_: %s", a.AccountCode)
	}
	if !strings.HasSuffix(a.AccountCode, "_usd") {
		t.Errorf("account code should end with _usd: %s", a.AccountCode)
	}

	// Verify the account exists and is linked.
	var linked uuid.UUID
	var currency, accType string
	err = pool.QueryRow(ctx, `
		SELECT agent_id, currency, type FROM accounts WHERE code = $1
	`, a.AccountCode).Scan(&linked, &currency, &accType)
	if err != nil {
		t.Fatalf("account lookup: %v", err)
	}
	if linked != a.ID {
		t.Errorf("agent_id mismatch: want %s, got %s", a.ID, linked)
	}
	if currency != "USD" {
		t.Errorf("account currency: want USD, got %s", currency)
	}
	if accType != "asset" {
		t.Errorf("account type: want asset, got %s", accType)
	}
}

// TestSpawnAgentDuplicateNameRejected asserts (org_id, name) uniqueness.
func TestSpawnAgentDuplicateNameRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	a, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "test-dupe", "USD")
	if err != nil {
		t.Fatalf("first spawn: %v", err)
	}
	defer func() {
		pool.Exec(ctx, "DELETE FROM accounts WHERE agent_id = $1", a.ID)
		pool.Exec(ctx, "DELETE FROM agents WHERE id = $1", a.ID)
	}()

	if _, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "test-dupe", "EUR"); !errors.Is(err, ErrAgentExists) {
		t.Errorf("second spawn: want ErrAgentExists, got %v", err)
	}
}

// TestSpawnAgentUnknownCurrencyRejected asserts currency validation fires
// before any DB writes.
func TestSpawnAgentUnknownCurrencyRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	_, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "test-bad-curr", "XYZ")
	if !errors.Is(err, ErrUnknownCurrency) {
		t.Errorf("want ErrUnknownCurrency, got %v", err)
	}
}

// TestSpawnAgentEmptyNameRejected asserts whitespace-only names are caught
// before hitting the DB.
func TestSpawnAgentEmptyNameRejected(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	for _, n := range []string{"", "   ", "\t"} {
		if _, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, n, "USD"); err == nil {
			t.Errorf("name=%q: expected error, got nil", n)
		}
	}
}

// TestListAgentsIncludesBalance asserts the list endpoint joins through to
// the agent's account and reports the realised balance.
func TestListAgentsIncludesBalance(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	a, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "test-list", "USD")
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	defer func() {
		pool.Exec(ctx, "DELETE FROM accounts WHERE agent_id = $1", a.ID)
		pool.Exec(ctx, "DELETE FROM agents WHERE id = $1", a.ID)
	}()

	agents, err := ListAgents(ctx, pool, orgID, DemoTenantID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	var found *AgentSummary
	for i := range agents {
		if agents[i].ID == a.ID {
			found = &agents[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("just-spawned agent %s not in list", a.ID)
	}
	if found.Balance != 0 {
		t.Errorf("fresh agent balance: want 0, got %d", found.Balance)
	}
	if found.Currency != "USD" {
		t.Errorf("currency: want USD, got %s", found.Currency)
	}
}

// TestSetAgentStatusFlipsStatus asserts kill / pause work and ErrAgentNotFound
// fires for unknown agent ids.
func TestSetAgentStatusFlipsStatus(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	a, err := SpawnAgent(ctx, pool, orgID, DemoTenantID, "test-kill", "USD")
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	defer func() {
		pool.Exec(ctx, "DELETE FROM accounts WHERE agent_id = $1", a.ID)
		pool.Exec(ctx, "DELETE FROM agents WHERE id = $1", a.ID)
	}()

	if err := SetAgentStatus(ctx, pool, orgID, DemoTenantID, a.ID, AgentKilled); err != nil {
		t.Fatalf("kill: %v", err)
	}

	got, err := GetAgent(ctx, pool, orgID, DemoTenantID, a.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != AgentKilled {
		t.Errorf("status: want killed, got %s", got.Status)
	}

	if err := SetAgentStatus(ctx, pool, orgID, DemoTenantID, uuid.New(), AgentKilled); !errors.Is(err, ErrAgentNotFound) {
		t.Errorf("unknown id: want ErrAgentNotFound, got %v", err)
	}
}

// TestGetAgentNotFound asserts ErrAgentNotFound on missing id.
func TestGetAgentNotFound(t *testing.T) {
	pool := openTestDB(t)
	orgID := uuid.MustParse(demoOrgID)
	ctx := context.Background()

	if _, err := GetAgent(ctx, pool, orgID, DemoTenantID, uuid.New()); !errors.Is(err, ErrAgentNotFound) {
		t.Errorf("want ErrAgentNotFound, got %v", err)
	}
}
