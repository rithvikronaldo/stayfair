-- 008_unique_per_tenant.up.sql
-- Multi-tenancy bug fix: agents and accounts had UNIQUE (org_id, name|code)
-- from before 007 added tenant_id. Because every tenant shares the same
-- demoOrgID for backwards compatibility, two tenants couldn't use the same
-- account/agent name even though they're isolated. A signup → curl →
-- spawn-account flow hit `agent_exists` if another tenant had already used
-- that name.
--
-- Fix: scope the unique constraints by tenant_id instead. RELAXES the
-- constraint (org+name was stricter than tenant+name because all tenants
-- share one org), so no existing rows violate it.

----------------------------------------------------------------
-- agents: (org_id, name) → (tenant_id, name)
----------------------------------------------------------------
ALTER TABLE agents DROP CONSTRAINT agents_org_id_name_key;
ALTER TABLE agents ADD CONSTRAINT agents_tenant_id_name_key UNIQUE (tenant_id, name);

----------------------------------------------------------------
-- accounts: (org_id, code) → (tenant_id, code)
----------------------------------------------------------------
ALTER TABLE accounts DROP CONSTRAINT accounts_org_id_code_key;
ALTER TABLE accounts ADD CONSTRAINT accounts_tenant_id_code_key UNIQUE (tenant_id, code);
