-- 008_unique_per_tenant.down.sql
-- Revert: scope uniqueness back to org_id.

ALTER TABLE accounts DROP CONSTRAINT accounts_tenant_id_code_key;
ALTER TABLE accounts ADD CONSTRAINT accounts_org_id_code_key UNIQUE (org_id, code);

ALTER TABLE agents DROP CONSTRAINT agents_tenant_id_name_key;
ALTER TABLE agents ADD CONSTRAINT agents_org_id_name_key UNIQUE (org_id, name);
