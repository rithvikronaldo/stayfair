import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs — acta",
  description:
    "API reference for the acta ledger sandbox. Signup, transactions, authorize/capture/void, point-in-time balance queries, multi-tenant scoping.",
};

// Server-rendered docs page. Reads NEXT_PUBLIC_API_URL at build time so the
// curl examples land with the real base URL after deploy; falls back to
// localhost for local dev.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default function DocsPage() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
        <Intro />
        <Quickstart />
        <Auth />
        <Tenants />
        <Accounts />
        <Transactions />
        <Authorizations />
        <Balances />
        <Stress />
        <EventsStream />
        <Multitenancy />
        <Foot />
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-6 sm:px-8">
        <Link
          href="/"
          className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fg hover:opacity-80"
        >
          <span>ACTA</span>
          <span className="text-dim">·</span>
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
            Docs
          </span>
        </Link>
        <Link
          href="/"
          className="num text-[11px] uppercase tracking-[0.14em] text-muted hover:text-fg"
        >
          ← Dashboard
        </Link>
      </div>
    </header>
  );
}

function Intro() {
  return (
    <section className="mb-12 border-b border-border pb-8">
      <h1 className="text-3xl font-light text-fg sm:text-4xl">
        API reference
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        A multi-currency, double-entry, point-in-time-queryable ledger. Sign up
        for an API key, post a balanced transaction with curl, query the
        balance at any past timestamp.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Base URL:{" "}
        <code className="num bg-surface-1 px-1.5 py-0.5 text-[12px] text-fg">
          {API_URL}
        </code>
      </p>
    </section>
  );
}

function Quickstart() {
  return (
    <Section id="quickstart" title="Quickstart">
      <p className="text-[14px] leading-relaxed text-muted">
        Sixty seconds, four steps.
      </p>
      <ol className="mt-4 space-y-3 text-[14px] leading-relaxed text-muted">
        <li>
          <span className="text-fg">1.</span> Sign up at{" "}
          <Link href="/" className="text-accent hover:opacity-80">
            the dashboard
          </Link>{" "}
          and copy the <code className="num text-fg">ac_…</code> key.
        </li>
        <li>
          <span className="text-fg">2.</span> Create your first account:
        </li>
      </ol>
      <CodeBlock>{`curl -X POST ${API_URL}/agents \\
  -H "Authorization: Bearer ac_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "treasury", "currency": "USD"}'`}</CodeBlock>
      <ol className="mt-3 space-y-3 text-[14px] leading-relaxed text-muted" start={3}>
        <li>
          <span className="text-fg">3.</span> Within five seconds the
          dashboard's left rail shows your new account.
        </li>
        <li>
          <span className="text-fg">4.</span> Post a balanced transaction (see{" "}
          <a href="#transactions" className="text-accent hover:opacity-80">
            Transactions
          </a>
          ).
        </li>
      </ol>
    </Section>
  );
}

function Auth() {
  return (
    <Section id="auth" title="Authentication">
      <p className="text-[14px] leading-relaxed text-muted">
        Every authenticated request carries an{" "}
        <code className="num text-fg">Authorization: Bearer ac_…</code>{" "}
        header. The middleware looks up the tenant by SHA-256 hash of the key
        and stashes the tenant id on the request. Every handler downstream
        reads from there.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Requests without a Bearer header resolve to the public{" "}
        <strong className="text-fg">demo tenant</strong> — that's what the
        unsigned dashboard sees.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        The raw key is returned exactly once at signup. We never store the raw
        value; the database only sees the hash. If the DB leaks, the keys
        aren't usable directly.
      </p>
    </Section>
  );
}

function Tenants() {
  return (
    <Section id="tenants" title="Tenants & signup">
      <Endpoint
        method="POST"
        path="/tenants"
        desc="Create a tenant — or, if the email already exists, rotate its API key and return the existing tenant. Idempotent on email. The `created` flag distinguishes a fresh signup (true) from a rotation (false). The raw key is shown once; the database only stores its SHA-256 hash."
        curl={`curl -X POST ${API_URL}/tenants \\
  -H "Content-Type: application/json" \\
  -d '{"email": "you@example.com", "name": "Acme"}'`}
        response={`{
  "tenant": {
    "id": "8f3e…",
    "email": "you@example.com",
    "name": "Acme",
    "created_at": "2026-05-18T09:12:43Z"
  },
  "api_key": "ac_REPLACE_WITH_YOUR_KEY",
  "created": true,
  "api_key_warning": "Save this key — it will not be shown again."
}`}
      />
      <Endpoint
        method="GET"
        path="/tenants/me"
        desc="Returns the tenant the current Bearer key resolves to. Falls back to the demo tenant for unauthenticated requests."
        curl={`curl ${API_URL}/tenants/me \\
  -H "Authorization: Bearer ac_YOUR_KEY"`}
        response={`{
  "id": "8f3e…",
  "email": "you@example.com",
  "name": "Acme",
  "created_at": "2026-05-18T09:12:43Z"
}`}
      />
    </Section>
  );
}

function Accounts() {
  return (
    <Section id="accounts" title="Accounts">
      <p className="text-[14px] leading-relaxed text-muted">
        Accounts are the leaves of the ledger. An account has a code, a
        currency, and a type (<code className="num text-fg">asset</code>,{" "}
        <code className="num text-fg">liability</code>,{" "}
        <code className="num text-fg">revenue</code>, etc.). Entries write to
        accounts in their native currency.
      </p>
      <Endpoint
        method="POST"
        path="/agents"
        desc="Create an account. Returns the account code derived from the new account's UUID."
        curl={`curl -X POST ${API_URL}/agents \\
  -H "Authorization: Bearer ac_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "treasury", "currency": "USD"}'`}
        response={`{
  "id": "c8b25369-…",
  "name": "treasury",
  "status": "active",
  "currency": "USD",
  "account_code": "agent_c8b25369_usd",
  "created_at": "2026-05-18T09:13:01Z"
}`}
      />
      <Endpoint
        method="GET"
        path="/agents"
        desc="List the accounts under the current tenant."
        curl={`curl ${API_URL}/agents \\
  -H "Authorization: Bearer ac_YOUR_KEY"`}
      />
    </Section>
  );
}

function Transactions() {
  return (
    <Section id="transactions" title="Transactions">
      <p className="text-[14px] leading-relaxed text-muted">
        Every transaction is a set of entries that sum to zero per currency.
        The invariant <code className="num text-fg">Σ in = Σ out</code> is
        enforced twice — in Go before the write, and again at COMMIT by a
        Postgres trigger.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Amounts are integer minor units. <code className="num text-fg">1000000</code>{" "}
        means ₹10,000.00 (paise) or $10,000.00 (cents) depending on the row's
        currency.
      </p>
      <Endpoint
        method="POST"
        path="/transactions"
        desc="Post a balanced transaction. Use the Idempotency-Key header so retries don't double-write. A request with a known key replays the original response and adds Idempotent-Replay: true."
        curl={`curl -X POST ${API_URL}/transactions \\
  -H "Authorization: Bearer ac_YOUR_KEY" \\
  -H "Idempotency-Key: settle_2026_05_29_batch_001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "Card settlement — vendor split",
    "occurred_at": "2026-05-29T14:32:00Z",
    "entries": [
      {"account": "cash",         "amount": 100000, "currency": "USD", "direction": "out"},
      {"account": "vendor_pool",  "amount":  85000, "currency": "USD", "direction": "in"},
      {"account": "fees",         "amount":  13000, "currency": "USD", "direction": "in"},
      {"account": "reserve",      "amount":   2000, "currency": "USD", "direction": "in"}
    ]
  }'`}
      />
      <Endpoint
        method="GET"
        path="/transactions"
        desc="List transactions for the current tenant, newest first. Cursor pagination via the `cursor` query param."
        curl={`curl "${API_URL}/transactions?limit=50" \\
  -H "Authorization: Bearer ac_YOUR_KEY"`}
      />
      <Errors />
    </Section>
  );
}

function Errors() {
  return (
    <div className="mt-6 border border-border bg-surface-1 p-4">
      <div className="num mb-2 text-[10px] uppercase tracking-[0.14em] text-muted">
        Error semantics
      </div>
      <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted">
        <li>
          <code className="num text-fg">422 unbalanced</code> — Σ in ≠ Σ out
          per currency. Body has{" "}
          <code className="num">currency, in, out, diff</code>.
        </li>
        <li>
          <code className="num text-fg">422 idempotency_hash_mismatch</code> —
          same key, different body. Client bug — fix and retry.
        </li>
        <li>
          <code className="num text-fg">409 idempotency_pending</code> — a
          request with the same key is still processing.
        </li>
        <li>
          <code className="num text-fg">200 OK</code> +{" "}
          <code className="num text-fg">Idempotent-Replay: true</code> — retry
          succeeded; original response replayed.
        </li>
      </ul>
    </div>
  );
}

function Authorizations() {
  return (
    <Section
      id="authorizations"
      title="Authorize → capture → void"
    >
      <p className="text-[14px] leading-relaxed text-muted">
        Two-stage money movement. <code className="num text-fg">Authorize</code>{" "}
        reserves funds (creates an <code className="num text-fg">on_hold</code>{" "}
        amount distinct from the realised balance). <code className="num text-fg">Capture</code>{" "}
        confirms a portion (or all) and releases the rest. <code className="num text-fg">Void</code>{" "}
        releases the whole reservation without capturing.
      </p>
      <Endpoint
        method="POST"
        path="/authorizations"
        desc="Reserve an amount from source to dest."
        curl={`curl -X POST ${API_URL}/authorizations \\
  -H "Authorization: Bearer ac_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source": "agent_<id>_usd",
    "dest":   "vendor_pool_usd",
    "amount": 500,
    "currency": "USD",
    "description": "subscription"
  }'`}
      />
      <Endpoint
        method="POST"
        path="/authorizations/:id/capture"
        desc="Capture a portion of the reserved amount."
        curl={`curl -X POST ${API_URL}/authorizations/<auth.id>/capture \\
  -H "Authorization: Bearer ac_YOUR_KEY" \\
  -d '{"amount": 430}'`}
      />
      <Endpoint
        method="POST"
        path="/authorizations/:id/void"
        desc="Release the entire reservation. Idempotent."
        curl={`curl -X POST ${API_URL}/authorizations/<auth.id>/void \\
  -H "Authorization: Bearer ac_YOUR_KEY" \\
  -d '{}'`}
      />
    </Section>
  );
}

function Balances() {
  return (
    <Section id="balances" title="Point-in-time balances">
      <p className="text-[14px] leading-relaxed text-muted">
        <code className="num text-fg">GET /accounts/:code/balance</code>{" "}
        returns three numbers: <code className="num text-fg">balance</code>{" "}
        (realised), <code className="num text-fg">available</code>{" "}
        (balance minus pending authorizations), and{" "}
        <code className="num text-fg">on_hold</code> (sum of pending). The{" "}
        <code className="num text-fg">as_of</code> and{" "}
        <code className="num text-fg">in</code> query params do the time-travel
        and FX conversion.
      </p>
      <Endpoint
        method="GET"
        path="/accounts/:code/balance"
        desc="Balance now, in the account's native currency."
        curl={`curl ${API_URL}/accounts/treasury/balance \\
  -H "Authorization: Bearer ac_YOUR_KEY"`}
      />
      <Endpoint
        method="GET"
        path="/accounts/:code/balance?as_of=&in="
        desc="Balance at a past timestamp, converted to a target currency using the FX rate that was current at that timestamp."
        curl={`curl "${API_URL}/accounts/treasury/balance?as_of=2026-04-21T14:32:00Z&in=EUR" \\
  -H "Authorization: Bearer ac_YOUR_KEY"`}
        response={`{
  "account": "treasury",
  "currency": "EUR",
  "balance": 11891,
  "as_of": "2026-04-21T14:32:00Z"
}`}
      />
    </Section>
  );
}

function Stress() {
  return (
    <Section id="stress" title="Stress / load test">
      <p className="text-[14px] leading-relaxed text-muted">
        Bulk-post N balanced transactions through the same{" "}
        <code className="num text-fg">ledger.Post()</code> primitive every
        other write uses. No fast path, no fixtures — real entries, real
        commits, same invariant check. The endpoint is rate-limited to
        signed-in tenants and capped at <code className="num text-fg">N = 10,000</code>{" "}
        per call. Used by the dashboard's ▶ Stress 1k button and by anyone
        wanting to measure their own ledger's throughput honestly.
      </p>
      <Endpoint
        method="POST"
        path="/stress"
        desc="Run a bulk-post stress test against the current tenant. `n` is the number of transactions to post; `concurrency` (optional, default 1) spreads them across N goroutines. Returns aggregate timing + the invariant-violations counter (always 0 by construction — every Post() runs CheckBalanced + the deferred Postgres trigger)."
        curl={`curl -X POST ${API_URL}/stress \\
  -H "Authorization: Bearer ac_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"n": 1000, "concurrency": 4}'`}
        response={`{
  "n_posted": 1000,
  "elapsed_ms": 2037,
  "tps_peak": 491.2,
  "p50_commit_ms": 7.9,
  "p99_commit_ms": 14.5,
  "invariant_violations": 0,
  "serialization_retries": 0,
  "currency": "USD"
}`}
      />
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Numbers above are from an M-series local + Postgres in Docker.
        <code className="num text-fg"> serialization_retries</code> stays at 0
        because <code className="num text-fg">ledger.Post()</code> is{" "}
        <code className="num text-fg">READ COMMITTED</code> + append-only —
        no read-modify-write on account rows, no{" "}
        <code className="num text-fg">FOR UPDATE</code>, nothing for Postgres
        to abort and retry. Contention shows up as lock-wait latency, not
        40001 errors.
      </p>
    </Section>
  );
}

function EventsStream() {
  return (
    <Section id="events" title="Events stream (SSE)">
      <p className="text-[14px] leading-relaxed text-muted">
        Server-Sent Events. Subscribe with any HTTP client that speaks{" "}
        <code className="num text-fg">text/event-stream</code>. Auto-reconnects
        from the browser; the dashboard uses this for the live transaction
        stream.
      </p>
      <Endpoint
        method="GET"
        path="/events/stream"
        desc="Stream of ledger events for the current tenant. Demo tenant by default; sign in to filter to your own."
        curl={`curl -N ${API_URL}/events/stream`}
      />
    </Section>
  );
}

function Multitenancy() {
  return (
    <Section id="multitenancy" title="Multi-tenancy">
      <p className="text-[14px] leading-relaxed text-muted">
        Every signup creates a tenant. Every row in{" "}
        <code className="num text-fg">accounts</code>,{" "}
        <code className="num text-fg">transactions</code>,{" "}
        <code className="num text-fg">authorizations</code>,{" "}
        <code className="num text-fg">idempotency_keys</code>, and{" "}
        <code className="num text-fg">agents</code> carries a{" "}
        <code className="num text-fg">tenant_id</code>. Every query filters
        by it. Cross-tenant isolation is enforced by predicate, tested by{" "}
        <code className="num text-fg">go test -run CrossTenant</code> (five
        integration tests covering read and write paths).
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Trade-off chosen over Postgres Row-Level Security: the predicate
        lives in the SQL where{" "}
        <code className="num text-fg">EXPLAIN</code> can see it, not in a
        policy that has to be reverse-engineered when a row goes missing.
        RLS ties the predicate to a session variable inside a transaction;
        pgx pools recycle connections; one leaked{" "}
        <code className="num text-fg">SET LOCAL</code> away from a
        cross-tenant read. The predicate written in every SQL string is
        uglier but grep-able and code-reviewable.
      </p>
    </Section>
  );
}

function Foot() {
  return (
    <footer className="mt-16 border-t border-border pt-6 text-[12px] text-dim">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="num uppercase tracking-[0.14em]">acta</span>
        <span>·</span>
        <a
          href="https://github.com/rithvikronaldo/acta"
          className="hover:text-fg"
        >
          github
        </a>
        <span>·</span>
        <a href="https://rithvikronaldo.dev" className="hover:text-fg">
          building notes
        </a>
        <span>·</span>
        <span className="text-muted">MIT</span>
      </div>
    </footer>
  );
}

// --- Reusable primitives ---

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-16">
      <h2 className="num mb-4 text-[11px] uppercase tracking-[0.14em] text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Endpoint({
  method,
  path,
  desc,
  curl,
  response,
}: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  desc: string;
  curl: string;
  response?: string;
}) {
  const methodColor =
    method === "POST"
      ? "text-accent"
      : method === "DELETE"
        ? "text-red"
        : "text-fg";
  return (
    <div className="mt-5 border border-border bg-surface-1 p-4">
      <div className="flex items-baseline gap-3">
        <span className={`num text-[11px] font-semibold uppercase tracking-[0.14em] ${methodColor}`}>
          {method}
        </span>
        <code className="num text-[13px] text-fg">{path}</code>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{desc}</p>
      <CodeBlock>{curl}</CodeBlock>
      {response && (
        <>
          <div className="num mt-3 text-[10px] uppercase tracking-[0.14em] text-dim">
            Response
          </div>
          <CodeBlock>{response}</CodeBlock>
        </>
      )}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="num mt-2 overflow-x-auto whitespace-pre border border-border-2 bg-bg p-3 text-[11px] leading-relaxed text-fg">
      {children}
    </pre>
  );
}
