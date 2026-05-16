-- 006_tenants.up.sql
-- The tenants table that owns every other row in the ledger from here on.
-- A tenant is the unit of isolation: one signup → one tenant → one API key.
-- The existing data (5 demo accounts, ~thousand transactions, etc.) is
-- migrated under a single 'Demo Tenant' in 007.
--
-- API key handling: the column stores SHA-256 of the key as hex. Even if
-- the DB leaks, the keys aren't usable directly — the auth middleware
-- hashes the incoming Bearer token and looks up by hash. We never store
-- the raw key.

CREATE TABLE tenants (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    api_key_hash  TEXT UNIQUE NOT NULL,
    name          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the demo tenant with a fixed UUID. 007 backfills every existing
-- row against this id; the public dashboard reads under it without auth.
-- The demo API key is an intentionally public, known string — the auth
-- middleware recognises the demo tenant and treats its routes as
-- read-only-public.
INSERT INTO tenants (id, email, api_key_hash, name) VALUES (
    '00000000-0000-0000-0000-000000000010',
    'demo@acta.local',
    encode(sha256('acta-demo-public-key'::bytea), 'hex'),
    'Demo Tenant'
);
