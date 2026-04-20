CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE entry_direction AS ENUM ('in', 'out');
CREATE TYPE idempotency_status AS ENUM ('pending', 'completed');

CREATE TABLE orgs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE currencies (
    code             CHAR(3) PRIMARY KEY,
    minor_unit_scale SMALLINT NOT NULL
);

CREATE TABLE accounts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    code       TEXT NOT NULL,
    name       TEXT NOT NULL,
    type       account_type NOT NULL,
    currency   CHAR(3) NOT NULL REFERENCES currencies(code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, code)
);

CREATE TABLE transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id     UUID NOT NULL REFERENCES accounts(id),
    amount         BIGINT NOT NULL CHECK (amount >= 0),
    currency       CHAR(3) NOT NULL REFERENCES currencies(code),
    direction      entry_direction NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
    org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    key          TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response     JSONB,
    status       idempotency_status NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, key)
);

CREATE TABLE fx_rates (
    from_currency CHAR(3) NOT NULL REFERENCES currencies(code),
    to_currency   CHAR(3) NOT NULL REFERENCES currencies(code),
    rate          NUMERIC(20, 10) NOT NULL,
    as_of         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (from_currency, to_currency, as_of)
);
