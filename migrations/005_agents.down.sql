DROP INDEX IF EXISTS idx_accounts_agent_id;
ALTER TABLE accounts DROP COLUMN IF EXISTS agent_id;
DROP TABLE IF EXISTS agents;
DROP TYPE IF EXISTS agent_status;
