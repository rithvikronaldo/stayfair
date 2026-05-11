-- 006_tenants.down.sql
-- Drops the tenants table. Must run after 007 down (which removes the
-- tenant_id FK references on every other table).

DROP TABLE IF EXISTS tenants;
