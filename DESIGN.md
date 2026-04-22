# Design decisions

This document captures the key choices behind the StayFair ledger — the
non-obvious ones that would take a while to rediscover from reading the
code alone. Each section explains what was chosen, why, and what the
trade-off is.

## 1. The balance invariant is enforced in two places

The core rule of the ledger is: **Σ in = Σ out, per currency, per
transaction.** Money is never created or destroyed between accounts.

That rule is enforced twice:

- **In Go**, in [`internal/ledger/invariant.go`](internal/ledger/invariant.go) — `CheckBalanced()`
  runs before any DB write and fails fast with a descriptive error.
- **In Postgres**, via an `AFTER INSERT DEFERRABLE INITIALLY DEFERRED`
  constraint trigger in [`migrations/002_invariant_trigger.up.sql`](migrations/002_invariant_trigger.up.sql).
  The trigger sums entries grouped by `(transaction_id, currency)` and
  raises `ENTRIES_UNBALANCED` at COMMIT if any group is off.

**Why both.** The Go check is the friendly layer — it returns a
structured 422 with `{currency, in, out, diff}` so clients can display a
useful error. But the Go code can have bugs. A future refactor could
accidentally skip the check; a migration script could write raw SQL;
someone could connect `psql` and type inserts by hand. The database
trigger is the last line of defence: no matter how data arrives, the DB
refuses to commit corrupt entries.

[`internal/ledger/trigger_test.go`](internal/ledger/trigger_test.go)
proves this by writing unbalanced entries via raw SQL (bypassing all Go
code) and asserting that `COMMIT` raises. That test is the receipt for
the whole approach.

**Trade-off.** Duplicate logic. If we ever change the invariant (we
won't), both places need updating. That's acceptable — the invariant is
the cornerstone of double-entry bookkeeping; it's stable at a 500-year
timescale.

## 2. Money is stored as `BIGINT` minor units, never `FLOAT` or `NUMERIC`

Every `amount` column in the schema is `BIGINT NOT NULL CHECK (amount >= 0)`.
`1000000` means ₹10,000.00 (paise) or $10,000.00 (cents), depending on
the row's currency.

**Why not `FLOAT`.** IEEE 754 floating-point arithmetic cannot represent
`0.1 + 0.2` exactly. Financial systems using floats accumulate cents of
drift over millions of transactions and produce unreconcilable ledgers.
This is a well-known failure mode — Stripe, Plaid, every serious fintech
uses integer minor units.

**Why not `NUMERIC` (aka `DECIMAL`).** `NUMERIC` is exact but orders of
magnitude slower for arithmetic, and allows sloppy implicit rounding
during division. With `BIGINT`, every operation is explicit integer math,
and FX conversion becomes an obvious two-step (multiply by rate, then
divide with a declared rounding mode).

**Trade-off.** You have to remember the currency's scale when rendering.
`currencies.minor_unit_scale` is `2` for paise/cents, `0` for Japanese
yen, `3` for Kuwaiti dinar. Display-layer code divides and formats; the
storage layer never touches floats.

## 3. Entries separate magnitude from direction

Each entry row stores `amount` as a non-negative integer, with a separate
`direction` column (enum: `'in'` or `'out'`). An outflow is `direction =
'out'` with a positive amount, not a negative amount.

**Why.** A negative number flowing the wrong way is invisible — the
database doesn't know it's wrong. By disallowing negatives entirely (`CHECK
(amount >= 0)`), the data model makes invalid states unrepresentable. The
direction enum then carries the sign explicitly, so every row is
self-documenting.

**Trade-off.** Queries that want a signed sum need a `CASE` expression
(`SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END)`). Minor.

## 4. Idempotency keys carry a request hash, not just the key

The `idempotency_keys` table stores `(org_id, key, request_hash, status,
response)`. On retry we check both the key AND the SHA-256 hash of the
request body.

**Why.** Just matching on the key is a trap: a buggy client that accidentally
reuses an idempotency key for a different payload would get back a stale,
unrelated response. That silent error can destroy a customer's trust.
With the hash check, a key-reuse-with-different-body returns a 422
`idempotency_hash_mismatch` instead — clients see the bug immediately.

The table also has a `status` column (`pending` / `completed`). A retry
that arrives while the original is still processing gets a 409, not a
duplicate write.

**Trade-off.** Every request pays the cost of SHA-256'ing its body and
one extra table lookup. Negligible.

## 5. The Postgres trigger is `DEFERRABLE INITIALLY DEFERRED`

A naive trigger would fire after every row insert. But a transaction
with 4 entries inserts 4 rows — after the 1st row the sum isn't
balanced yet. A non-deferred trigger would reject every valid
transaction.

**Why deferred.** With `DEFERRABLE INITIALLY DEFERRED`, the check is
delayed until `COMMIT` — by then all the rows are in, and the function
can sum the full set and judge correctly. This is the feature that
makes DB-level invariant enforcement possible at all.

**Trade-off.** The check runs once per row in the transaction (4× for a
4-entry transaction), which is technically wasteful. Each call is a
small aggregate query, so this is a non-issue at realistic volumes. A
future optimisation could guard with a session-level sentinel to run it
exactly once per transaction.

## 6. ENUMs over `TEXT` for fixed-choice columns

Three enums in [`migrations/001_schema.up.sql`](migrations/001_schema.up.sql):
`account_type`, `entry_direction`, `idempotency_status`.

**Why.** Plain `TEXT` columns accept typos silently — `"In"` with a
capital I would pass. A query then filters by `"in"` and misses those
rows. Debugging the resulting bug is invisible and expensive.

An enum rejects `"In"` at insert time. The DB becomes a typo-proof
contract. The Go code mirrors each enum as a typed constant
(`ledger.DirIn`, `ledger.DirOut`), so the two layers stay in sync.

**Trade-off.** Adding a new enum value requires a migration. That's a
feature, not a bug — it forces you to think about whether new values
are backwards-compatible.

## 7. IDs are UUIDs, generated in the database

Every primary key uses `UUID PRIMARY KEY DEFAULT gen_random_uuid()`. The
Go code never generates IDs; they come back from `INSERT ... RETURNING
id` clauses.

**Why UUIDs.** They're globally unique without coordination, so you can
merge data across databases, shard across servers, or import from other
systems without ID collisions. Sequential integers are simpler but become
a nightmare at any scale.

**Why generated by the DB.** A single source of truth for ID allocation.
Application code can't accidentally reuse IDs by restarting or race with
itself. The DB is the only thing that ever stamps a new UUID.

**Trade-off.** UUIDs are 16 bytes vs. 4-8 bytes for integers. Irrelevant
at this scale; only matters for clustered indexes on hot tables with
billions of rows.

## 8. Every business table has `org_id`

`orgs`, `accounts`, `transactions`, `entries`, `idempotency_keys` — all
carry `org_id` with a foreign key to `orgs(id)`. Every production query
filters by it.

**Why.** Multi-tenancy. One customer's data must never leak into
another's. Enforcing `org_id` at the schema level (rather than relying on
application code to remember) makes the wrong query hard to write.

Not all tables need it. `currencies` is shared reference data — ISO 4217
codes don't change per customer. `fx_rates` is also global.

**Trade-off.** Every query carries an extra `WHERE org_id = $1`. Cheap
with the right indexes (added in Week 2 when real queries land).

## 9. `occurred_at` vs `created_at`

`transactions` has both. `occurred_at` is when the business event
happened in real-world time (e.g., when the booking confirmed).
`created_at` is when the row was written to the DB (auto-stamped).

**Why both.** Sometimes events are recorded after the fact — a backfill,
a delayed webhook, a batch import. Conflating "when it happened" with
"when we heard about it" produces inaccurate reports. Keeping them
separate lets you ask either question.

**Trade-off.** Clients must provide `occurred_at`. If they lie (send a
future date), we record what they say. That's fine for this project;
real financial systems layer source-of-truth checks on top.

## 10. `internal/` over `pkg/`

Backend packages live under `internal/`, which Go's compiler enforces as
private to this module. External consumers (Week 6 SDKs) will live in
separate modules under `sdk/go/` and `sdk/js/`.

**Why.** There's no reason for anyone to import our handler code, our
repo layer, or our config parser directly. They should interact via the
HTTP API or the SDKs. `internal/` makes this a compile-time guarantee,
not a social convention.

## What we deliberately skipped (and when we'll add each)

These are real gaps, not oversights:

- **Authentication and real tenant scoping.** The demo org is a hardcoded
  UUID. Real auth lands in Week 2+ alongside the balance queries, when
  there are multiple callers to distinguish.
- **FX rate population.** The `fx_rates` table exists but is empty.
  Populated in Week 2 when cross-currency balance queries land.
- **Indexes.** No indexes beyond PKs and UNIQUE constraints. Added on
  demand when a specific slow query appears — premature indexes slow
  writes without earning their keep.
- **Rate limiting.** Not yet. Added before public deployment (Week 6).
- **Observability (metrics, tracing).** Added before deployment.
- **Soft deletes.** Never. Reversals are done via new reversing entries
  (append-only log), per double-entry tradition.

## Revisit after Week 2

Every decision here is provisional. Week 2 introduces balance queries,
point-in-time reads, and FX conversion — any of which might expose a
wrong call above. This doc will be updated, not rewritten, when that
happens.
