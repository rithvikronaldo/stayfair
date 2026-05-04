-- Authorizations: the "hold then settle" pattern Stripe and every payments
-- system uses. An authorization reserves `amount` from a source account for
-- an eventual transfer to a destination account. It produces no entries by
-- itself — only a Capture creates the balanced transaction. A Void releases
-- the auth without any movement.
--
-- Lifecycle:
--   pending → captured (full or partial; remainder implicitly released)
--   pending → voided   (no transaction created)
--   pending → expired  (background job will mark these once we have one)

CREATE TYPE auth_status AS ENUM ('pending', 'captured', 'voided', 'expired');

CREATE TABLE authorizations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    source_account_id UUID NOT NULL REFERENCES accounts(id),
    dest_account_id   UUID NOT NULL REFERENCES accounts(id),
    amount            BIGINT NOT NULL CHECK (amount > 0),
    currency          CHAR(3) NOT NULL REFERENCES currencies(code),
    status            auth_status NOT NULL DEFAULT 'pending',
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
    captured_at       TIMESTAMPTZ,
    voided_at         TIMESTAMPTZ,
    captured_amount   BIGINT CHECK (
        captured_amount IS NULL OR (captured_amount > 0 AND captured_amount <= amount)
    ),
    transaction_id    UUID REFERENCES transactions(id),
    CHECK (source_account_id <> dest_account_id)
);

-- Computing on_hold for an account is the hot path for available-balance
-- queries (UI shows total / available / on_hold). Partial index on pending
-- rows only — captured/voided/expired auths don't contribute to on_hold.
CREATE INDEX idx_authorizations_source_pending
    ON authorizations (source_account_id, currency)
    WHERE status = 'pending';

-- For the agent-treasury dashboard's "list authorizations" panel, ordered
-- newest-first per org.
CREATE INDEX idx_authorizations_org_created
    ON authorizations (org_id, created_at DESC);
