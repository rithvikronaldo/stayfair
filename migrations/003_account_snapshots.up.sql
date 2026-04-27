-- Per-account, per-currency, per-date pre-computed balance.
-- Empty for now; populated on Wed Apr 29 by the snapshot worker. Accelerates
-- point-in-time balance queries: instead of summing every entry from time zero,
-- a query for "balance as of 2026-03-15" finds the nearest prior snapshot and
-- replays only the entries since.
CREATE TABLE account_snapshots (
    account_id  UUID    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    currency    CHAR(3) NOT NULL REFERENCES currencies(code),
    as_of_date  DATE    NOT NULL,
    balance     BIGINT  NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, currency, as_of_date)
);
