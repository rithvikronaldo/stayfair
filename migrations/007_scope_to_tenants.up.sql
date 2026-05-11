-- 007_scope_to_tenants.up.sql
-- Scope every existing table to a tenant. Backfill all rows under the
-- demo tenant (seeded in 006), then flip the new columns NOT NULL.
--
-- This migration is intentionally additive: the legacy `org_id` columns
-- stay until we're sure no code path reads them. A future migration drops
-- org_id entirely. For now, app code reads tenant_id from the auth
-- middleware and translates to org_id internally where existing queries
-- still expect it.
--
-- Tables NOT touched here:
--   entries           — inherits tenant scope via transaction_id
--   account_snapshots — inherits via account_id
--   fx_rates          — global, observation-based, no tenant ownership
--   currencies / orgs — system reference data
--
-- The five touched tables are the ones the application queries directly
-- with a tenant predicate.

----------------------------------------------------------------
-- 1. accounts
----------------------------------------------------------------
ALTER TABLE accounts ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE accounts SET tenant_id = '00000000-0000-0000-0000-000000000010';
ALTER TABLE accounts ALTER COLUMN tenant_id SET NOT NULL;

----------------------------------------------------------------
-- 2. transactions
----------------------------------------------------------------
ALTER TABLE transactions ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE transactions SET tenant_id = '00000000-0000-0000-0000-000000000010';
ALTER TABLE transactions ALTER COLUMN tenant_id SET NOT NULL;

----------------------------------------------------------------
-- 3. authorizations
----------------------------------------------------------------
ALTER TABLE authorizations ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE authorizations SET tenant_id = '00000000-0000-0000-0000-000000000010';
ALTER TABLE authorizations ALTER COLUMN tenant_id SET NOT NULL;

----------------------------------------------------------------
-- 4. idempotency_keys
----------------------------------------------------------------
ALTER TABLE idempotency_keys ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE idempotency_keys SET tenant_id = '00000000-0000-0000-0000-000000000010';
ALTER TABLE idempotency_keys ALTER COLUMN tenant_id SET NOT NULL;

----------------------------------------------------------------
-- 5. agents
----------------------------------------------------------------
ALTER TABLE agents ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE agents SET tenant_id = '00000000-0000-0000-0000-000000000010';
ALTER TABLE agents ALTER COLUMN tenant_id SET NOT NULL;

----------------------------------------------------------------
-- 6. Composite indexes for tenant-scoped query paths.
-- Every hot query that used to filter by org_id now filters by tenant_id.
-- The blog leads with EXPLAIN ANALYZE on `accounts` before/after this
-- index — keep the CREATE INDEX statements compact so the diff reads well.
----------------------------------------------------------------
CREATE INDEX idx_accounts_tenant_code         ON accounts         (tenant_id, code);
CREATE INDEX idx_transactions_tenant_occurred ON transactions     (tenant_id, occurred_at DESC);
CREATE INDEX idx_authorizations_tenant_status ON authorizations   (tenant_id, status);
CREATE INDEX idx_idempotency_keys_tenant_key  ON idempotency_keys (tenant_id, key);
CREATE INDEX idx_agents_tenant_name           ON agents           (tenant_id, name);
