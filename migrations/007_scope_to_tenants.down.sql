-- 007_scope_to_tenants.down.sql
-- Roll back: drop the composite indexes and the tenant_id columns.
-- After this runs, 006 down can safely DROP TABLE tenants.

DROP INDEX IF EXISTS idx_accounts_tenant_code;
DROP INDEX IF EXISTS idx_transactions_tenant_occurred;
DROP INDEX IF EXISTS idx_authorizations_tenant_status;
DROP INDEX IF EXISTS idx_idempotency_keys_tenant_key;
DROP INDEX IF EXISTS idx_agents_tenant_name;

ALTER TABLE accounts         DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE transactions     DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE authorizations   DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE agents           DROP COLUMN IF EXISTS tenant_id;
