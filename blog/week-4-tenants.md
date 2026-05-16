<!--
═══════════════════════════════════════════════════════════════════
HASHNODE DRAFT FIELDS — paste into the editor's UI, not the body
═══════════════════════════════════════════════════════════════════
Title:     Adding tenants to a ledger that had one for three weeks
Subtitle:  Application-scoping, cross-tenant isolation tests, and the trade-off I made over Postgres RLS.
Series:    Building a Double-Entry Ledger
Tags:      Go, PostgreSQL, Fintech, SaaS (max 5)
Slug:      adding-tenants-to-a-ledger
Cover:     [TODO: terminal screenshot of `go test -run TestCrossTenantIsolation -v`
            green PASS, with the two t.Logf lines visible:
              tenant A: N agents visible
              tenant B: 0 agents visible (isolation holds)]
═══════════════════════════════════════════════════════════════════
Body starts below this line.
═══════════════════════════════════════════════════════════════════
-->

For three weeks, every row in this ledger has had `org_id = 1`.

That was a Week 1 decision. Build the schema, the double-entry invariants, the snapshots, the FX layer — all under a single hardcoded org. Make it work for one tenant before making it work for many. The `org_id` column lived as a sentinel, threaded through every query, doing nothing useful but reminding me the abstraction existed.

This week I turned it on.

## The schema, additive

The default move on a multi-tenancy migration is rename-and-replace: rename `org_id` to `tenant_id`, foreign-key it to a fresh `tenants` table, drop the legacy column. Two-step deploy at minimum if you're cautious; harder to reverse once anything reads from the new column.

I went additive instead.

```sql
-- 006_tenants.up.sql
CREATE TABLE tenants (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    api_key_hash  TEXT UNIQUE NOT NULL,
    name          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tenants (id, email, api_key_hash, name) VALUES (
    '00000000-0000-0000-0000-000000000010',
    'demo@acta.local',
    encode(sha256('acta-demo-public-key'::bytea), 'hex'),
    'Demo Tenant'
);
```

A `tenants` table with one seeded row at a fixed UUID. The fixed UUID matters — every existing row in the database gets backfilled against it, and the public dashboard reads under it without auth. The demo tenant is the only id that ever shows up hardcoded in app code.

Migration 007 walks each scoped table:

```sql
ALTER TABLE accounts ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE accounts SET tenant_id = '00000000-0000-0000-0000-000000000010';
ALTER TABLE accounts ALTER COLUMN tenant_id SET NOT NULL;
```

Same three-step shape for `transactions`, `authorizations`, `idempotency_keys`, `agents`. Add nullable, backfill, flip NOT NULL. The `org_id` column stays — a later migration drops it once nothing reads from it.

Two tables don't get touched:

- `entries` inherits scope through `transaction_id` — the join is enough.
- `fx_rates` is global. Exchange rates aren't per-tenant.

Five composite indexes — one per scoped table — keyed on `(tenant_id, <hot_filter>)`. Every hot query that used to filter on `org_id` now filters on `tenant_id` instead, and Postgres picks the new composite index. Same Index Scan shape in the plan; just a different key.

## The predicate, threaded

A handler that used to look like this:

```go
agents, err := ledger.ListAgents(ctx, pool, orgID)
```

Now looks like this:

```go
tenantID := api.TenantID(c)             // resolved by middleware
agents, err := ledger.ListAgents(ctx, pool, orgID, tenantID)
```

The middleware does one job: pull the Bearer token off the `Authorization` header, hash it, look up the matching tenant, and stash the id on the request context (`c.Locals("tenant_id", t.ID)` in Fiber). Every downstream call reads it back and passes it through as an explicit parameter — the tenant flows through function signatures rather than living somewhere implicit.

The work isn't writing the predicate. The work is proving it can't be forgotten.

## The test that locks it in

If the `tenant_id` predicate can be silently dropped on any one query path, multi-tenancy is a story, not a guarantee. The protection has to come from a test that fails when the predicate is missing.

```go
func TestCrossTenantIsolation(t *testing.T) {
    pool := openTestDB(t)
    ctx := context.Background()

    // Tenant A: the seeded demo tenant.
    tenantA := DemoTenantID

    // Tenant B: fresh, no rows under it yet.
    tenantB, _, err := CreateTenant(ctx, pool,
        fmt.Sprintf("test-%d@example.com", time.Now().UnixNano()),
        "Cross-Tenant Test",
    )
    if err != nil { t.Fatalf("create tenant B: %v", err) }

    orgID := uuid.MustParse(demoOrgID)

    // Tenant A should see its demo agents.
    agentsA, _ := ListAgents(ctx, pool, orgID, tenantA)
    if len(agentsA) == 0 {
        t.Fatal("expected demo tenant to have agents")
    }

    // Tenant B must see zero — same org_id, different tenant_id.
    agentsB, _ := ListAgents(ctx, pool, orgID, tenantB.ID)
    if len(agentsB) != 0 {
        t.Fatalf("cross-tenant leak: B saw %d of A's agents", len(agentsB))
    }
}
```

The setup is deliberate. Tenant A is the seeded demo, which has rows from the backfill. Tenant B is freshly created, which has nothing. Both share the same `org_id`. If the WHERE clause filters only on `org_id`, tenant B sees tenant A's agents and the test fails. If the WHERE clause filters on `tenant_id`, tenant B sees zero and the test passes.

A second test covers writes — the harder case:

```go
func TestCaptureCrossTenantRejected(t *testing.T) {
    // Authorize under tenant A
    auth, _ := Authorize(ctx, pool, orgID, DemoTenantID, /* ... */)

    // Try to capture from tenant B — must reject
    _, err := Capture(ctx, pool, tenantB.ID, auth.ID, 50)
    if !errors.Is(err, ErrAuthNotFound) {
        t.Fatalf("captured another tenant's auth: %v", err)
    }
}
```

Hold tenant A's authorization id constant. Try to capture it as tenant B. The capture must fail with `ErrAuthNotFound` — not "permission denied," not a 403. The authorization must be invisible to tenant B, exactly as if it didn't exist. From tenant B's perspective, it doesn't.

That second test pinned a bug the migration had quietly surfaced. `Capture` and `Void` had been filtering on `auth.id` alone for three weeks. Fine when there's one tenant. Exploitable the moment there are two — guess the UUID and you've captured someone else's pending authorization. The bug wasn't introduced this week; it was *exposed* this week. The fix was two extra words in two SQL statements: `AND tenant_id = $2`.

These tests took an evening to write — five in total, covering every mutating path (`Authorize`, `Capture`, `Void`) and the read paths (`ListAgents`, `GetBalance`). They'll catch every future regression where someone forgets the predicate on a new query path.

## Why I skipped Postgres Row-Level Security

The alternative to threading `tenant_id` through every handler is Postgres RLS: enable it per table, write policies that compare each row's `tenant_id` against a session variable, set the variable in middleware. The application code stops thinking about scoping; the database does it.

I considered it. Three reasons I went the other way.

**Debugging `"why is this row missing"` gets harder, not easier.** With application-scoped predicates, the WHERE clause is right there in the SQL — `EXPLAIN` the query, read the plan, see the filter. With RLS, the predicate is added behind the scenes during query planning. A test failure that says "expected 5 rows, got 0" leads you straight to the code with predicate scoping. With RLS, it sends you out of the application's mental model and into database state — "did middleware set the session var?", "is the policy correct?".

**Every scoped table needs its own policy.** Five scoped tables means five policies to write, review, and audit — and the joins between them need careful thought about which side enforces the scope. One predicate threaded through function calls is fewer moving parts to keep correct than five policies plus their interaction.

**The tests above work either way.** If I'd built RLS first, I'd still want `TestCrossTenantIsolation`. The test doesn't care how the predicate gets onto the query — only that the result is zero rows for tenant B. So the real question is: which mechanism is easier to verify, debug, and onboard a new engineer to?

Application-scoping wins on all three for me. One mental model — `tenant_id` is a function parameter — covers every path. If the threat model changes (regulated industries, defense-in-depth requirements, third-party processors getting direct DB access), I'd revisit. Today, the simpler mechanism with the same test coverage is the right trade.

## The signup UX

The signup flow does one thing visibly and one thing carefully.

**Visibly:** a modal takes an email, posts to `POST /tenants`, and hands the user back two things — a Bearer token to paste into the dashboard, and a runnable `curl` command pre-filled with their key. The card is dismissible; clicking the close button collapses it to a chip that re-expands with a "show curl" toggle. Letting users tuck it away after copying keeps the dashboard clean during the signup-then-explore flow.

**Carefully:** the raw API key is returned exactly once, in the signup response body. I never store the raw value — only its SHA-256 hash, in the `api_key_hash` column. The auth middleware hashes incoming Bearer tokens and looks up the tenant by hash. If the database leaks tomorrow, the keys aren't directly usable.

```go
func generateAPIKey() (string, error) {
    b := make([]byte, 32)
    if _, err := rand.Read(b); err != nil {
        return "", err
    }
    return "ac_" + base64.RawURLEncoding.EncodeToString(b), nil
}
```

The `ac_` prefix is a GitHub-style convention — `ghp_` for GitHub personal tokens, `sk_` for Stripe secret keys. The prefix makes leaked keys greppable: secret-scanning tools (and humans) can pattern-match `ac_...` in committed code and flag it for rotation.

## What landed this week

- **`tenants` table** — id, email, api_key_hash, name, created_at
- **Migration backfill** — every row in `accounts`, `transactions`, `authorizations`, `idempotency_keys`, `agents` scoped to a seeded "Demo Tenant" at a fixed UUID
- **`POST /tenants`** — creates a tenant, returns Bearer + curl card
- **`GET /tenants/me`** — returns the resolved tenant for the current request
- **Auth middleware** — hashes incoming Bearer, looks up tenant, attaches id to context
- **Dashboard tenant switch** — signed-in users see their own data, unsigned see the demo
- **Cross-tenant isolation tests** — proves the predicate can't be silently dropped

## Next Sunday

Week 6 closes the build. After three Sundays of writing about a ledger you couldn't actually touch, next week it goes live: public docs, a runnable signup, an API key in 60 seconds at [acta.money](https://acta.money). The multi-tenancy work this week is what makes that possible — without per-tenant scoping, "public signup" is a synonym for "shared database."

I'm posting one of these every Sunday until the 6 weeks are up. Subscribe if you want the next one.

Repo: [github.com/rithvikronaldo/acta](https://github.com/rithvikronaldo/acta).
