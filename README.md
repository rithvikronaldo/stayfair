# StayFair

A double-entry ledger API with a live Airbnb-style marketplace demo on top. Built in Go + React.

Writing about the build at [rithvikronaldo.dev](https://rithvikronaldo.dev).

## Status

- Week 1 (Apr 19–26): schema + invariant enforcement + `POST /transactions`
- Week 2: balances + multi-currency + point-in-time queries
- Week 3: React dashboard — T-account visualizer
- Week 4: StayFair marketplace shell
- Week 5: live money-flow animation
- Week 6: deploy + SDKs + blog retro

See git tags for milestone snapshots.

## Run it locally

Requires: Go 1.23+, Docker (via colima or Docker Desktop), `golang-migrate` CLI, `make`.

```bash
# 1. Start Postgres in Docker (port 5433)
make db-up

# 2. Apply schema migrations
make migrate-up

# 3. Load demo fixtures (1 org, 4 currencies, 5 accounts)
make seed

# 4. Run the API
make run
```

In another terminal:

```bash
# Health check
curl localhost:8080/health
# → {"db":"ok","version":"0.1.0"}
```

## Example: post a balanced transaction

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

Amounts are in minor units (paise for INR), so `1000000` = ₹10,000.00.

## Responses

| Scenario | Status | Body |
|---|---|---|
| Balanced | `201 Created` | Posted transaction with IDs |
| Retry with same `Idempotency-Key` | `200 OK` + `Idempotent-Replay: true` | Original response bytes, no duplicate write |
| `Σ in ≠ Σ out` per currency | `422` | `{"error":"unbalanced","currency":"INR","in":…,"out":…,"diff":…}` |
| Unknown account code | `422` | `{"error":"unknown_account","message":…}` |
| Same key, different body | `422` | `{"error":"idempotency_hash_mismatch",…}` |
| Retry while first is still processing | `409` | `{"error":"idempotency_pending",…}` |
| Malformed JSON | `400` | `{"error":"invalid_json",…}` |

## Development

```bash
make test        # run the Go tests
make vet         # static checks
make psql        # shell into the Postgres container
make db-down     # stop Postgres (data persists)
```
