-- Agents are autonomous spenders (LLM agents in our use case). Each agent
-- has 1+ ledger accounts — one per currency it transacts in — and a
-- lifecycle status. "killed" is a soft delete: the rows stay, the
-- simulator stops scheduling spend, and the dashboard can still display
-- final balances. We don't enforce kill at the ledger layer because the
-- ledger is intentionally decoupled from agent semantics — anything that
-- can authorize is welcome to. The decision to stop authorizing for a
-- killed agent lives one layer up.

CREATE TYPE agent_status AS ENUM ('active', 'paused', 'killed');

CREATE TABLE agents (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    status     agent_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

-- Each account can belong to at most one agent. NULL means "house" account
-- (cash, revenue, liability lines from the original seed).
ALTER TABLE accounts ADD COLUMN agent_id UUID REFERENCES agents(id);

-- Hot path: list-agents-with-their-accounts joins from agents → accounts on
-- agent_id, and we usually want only the agent-owned ones.
CREATE INDEX idx_accounts_agent_id
    ON accounts (agent_id)
    WHERE agent_id IS NOT NULL;
