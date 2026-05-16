# acta

**A multi-currency, double-entry, point-in-time-queryable ledger sandbox for backend engineers.**

*Latin for "things done." A ledger is a record of things done. Live at [acta.money](https://acta.money).*

The ledger sandbox you wish existed when you were learning fintech backend. Sign up, get an API key, post your first transaction with curl, and watch it land in a real-time dashboard.

Building notes at [rithvikronaldo.dev](https://rithvikronaldo.dev).

## What you can do

- Post balanced double-entry transactions over HTTP, with idempotency keys
- Authorize → capture → void with `available` / `on_hold` semantics distinct from realised balance
- Query any account's balance at any past timestamp (`?as_of=2026-04-21T14:32:00Z`) via a snapshot+delta replay table
- Post transactions in any currency; FX rates are point-in-time too — `LookupRate` returns the latest observation ≤ your `as_of`
- Subscribe to `/events/stream` (Server-Sent Events) and watch transactions land in real time
- Open the live dashboard URL and view a public **demo tenant** with five named accounts emitting steady traffic — no signup required

## Status

| Week | Theme | Status |
|---|---|---|
| 1 (Apr 19–26) | Schema, balanced-entries trigger, `POST /transactions` | ✅ |
| 2 | Multi-currency FX, point-in-time balance queries, snapshot+delta | ✅ |
| 3 (May 4-10) | Authorize/capture lifecycle, SSE event stream, transaction list, agents schema | ✅ |
| 4 (May 11-17) | Frontend dashboard ships; ledger-sandbox repositioning | 🚧 |
| 5 (May 18-24) | Multi-tenancy: `tenants` table, API key auth, signup flow | 🔜 |
| 6 (May 25-31) | `/docs`, deploy, launch | 🔜 |

## Run it locally

Requires: Go 1.23+, Docker (Colima or Docker Desktop), `golang-migrate` CLI, `make`.

```bash
# 1. Start Postgres in Docker (port 5433)
make db-up

# 2. Apply schema migrations
make migrate-up

# 3. Load demo fixtures (1 tenant org, 4 currencies, 5 named accounts, treasury + vendor pools)
make seed

# 4. Run the API
make run
```

Then in another terminal:

```bash
curl localhost:8080/health
# → {"db":"ok","version":"0.1.0"}
```

## Post a balanced transaction

A guest pays ₹10,000 for a booking. The platform owes ₹8,500 to the host, keeps ₹1,300 as commission, and owes ₹200 in GST.

```bash
curl -X POST localhost:8080/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: booking_B001" \
  -d '{
    "description": "Booking #B001 confirmed",
    "occurred_at": "2026-04-21T14:32:00Z",
    "entries": [
      {"account": "guest_payments", "amount": 1000000, "currency": "INR", "direction": "in"},
      {"account": "host_payable",   "amount": 850000,  "currency": "INR", "direction": "out"},
      {"account": "commission",     "amount": 130000,  "currency": "INR", "direction": "out"},
      {"account": "gst_payable",    "amount": 20000,   "currency": "INR", "direction": "out"}
    ]
  }'
```

Amounts are in minor units (paise for INR, cents for USD/EUR/GBP), so `1000000` = ₹10,000.00.

## Response semantics

| Scenario | Status | Body |
|---|---|---|
| Balanced | `201 Created` | Posted transaction with IDs |
| Retry with same `Idempotency-Key` | `200 OK` + `Idempotent-Replay: true` | Original response bytes, no duplicate write |
| `Σ in ≠ Σ out` per currency | `422` | `{"error":"unbalanced","currency":"INR","in":…,"out":…,"diff":…}` |
| Unknown account code | `422` | `{"error":"unknown_account","message":…}` |
| Same key, different body | `422` | `{"error":"idempotency_hash_mismatch",…}` |
| Retry while first is still processing | `409` | `{"error":"idempotency_pending",…}` |
| Malformed JSON | `400` | `{"error":"invalid_json",…}` |

## Authorize / capture / void

```bash
# Reserve $5.00 from researcher → vendor pool
curl -X POST localhost:8080/authorizations -d '{
  "source": "agent_<id>_usd", "dest": "vendor_pool_usd",
  "amount": 500, "currency": "USD",
  "description": "cp:openai · researcher call"
}'
# → 201 with auth.id

# Capture $4.30 (balance moves; remainder released)
curl -X POST localhost:8080/authorizations/<auth.id>/capture -d '{"amount": 430}'

# Or release the whole hold without capturing
curl -X POST localhost:8080/authorizations/<auth.id>/void -d '{}'
```

`GET /accounts/<code>/balance` returns three numbers: `balance` (realised), `available` (`balance - sum(pending auths)`), and `on_hold` (`sum(pending auths)`).

## Point-in-time queries

```bash
# What was researcher's USD balance at 2:32pm IST on April 21?
curl 'localhost:8080/accounts/agent_<id>_usd/balance?as_of=2026-04-21T14:32:00+05:30'

# Same balance, expressed in EUR using the FX rate current at that timestamp
curl 'localhost:8080/accounts/agent_<id>_usd/balance?as_of=2026-04-21T14:32:00+05:30&in=EUR'
```

Implementation: a daily `account_snapshots` table, then SUM over `entries` after the snapshot's `as_of`. The `LookupRate` helper uses `WHERE as_of <= $1 ORDER BY as_of DESC LIMIT 1` semantics so historical balances always pick a defensible rate.

## Live dashboard

When the API is running, the frontend in `web/` is a Next.js 16 / React 19 / Tailwind 4 dashboard:

```bash
cd web
npm install --legacy-peer-deps
npm run dev
# → http://localhost:3000
```

The dashboard subscribes to `/events/stream` (SSE), maintains state in a Zustand store, animates with Motion v11 (springs, layout transitions, `useMotionValue` interpolation), and renders all numerics in JetBrains Mono with `tabular-nums` + `slashed-zero`. The default view is the public **demo tenant** — five named accounts (`researcher`, `analyst`, `writer`, `coder`, `translator`) emitting authorize/capture/void events at 1.2-3.6s intervals.

There's also a single-file vanilla-JS replica at `prototypes/dashboard.html` — no build, opens in any browser, useful for blog screenshots and Loom recordings.

## Audience

Built for backend engineers exploring or building on double-entry ledgers, multi-currency systems, or point-in-time accounting — particularly at and near Modern Treasury, Increase, Mercury, Bridge, Anrok, Rainforest, Rivet, and crypto exchanges with internal accounting needs.

If you're one of those engineers and want to chat: `rithvikronaldo@gmail.com` or DM me on the GitHub profile linked in the org.

## Development

```bash
make test                # run the Go tests
make test-integration    # tests against the live Postgres trigger
make vet                 # static checks
make psql                # shell into the Postgres container
make db-down             # stop Postgres (data persists)
make snapshot            # compute end-of-day account snapshots (default: yesterday UTC)
make snapshot DATE=2026-04-30
```

## License

MIT. See `LICENSE`.
