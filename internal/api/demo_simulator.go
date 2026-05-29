// Package api — demo simulator.
//
// The public dashboard at acta.rithvikronaldo.dev reads the demo tenant
// without auth so cold visitors see a live moving ledger within seconds.
// Previously the simulation ran in the browser (web/lib/driver.ts) and
// hit the demo tenant via unauthenticated POSTs. When mutations were
// gated behind RequireAuth, those POSTs started 401-ing and the demo
// stream went dead.
//
// This file moves the simulation to the server: a single goroutine
// authorizes → captures (or voids) random pairs on the demo tenant at a
// human-readable cadence, then publishes via the events broadcaster so
// SSE subscribers (the public dashboard's useEventStream) see real
// activity. No frontend mutation rights required.

package api

import (
	"context"
	"log"
	"math/rand"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/events"
	"github.com/rithvikronaldo/acta/internal/ledger"
)

// Cadence: a new authorize fires every ~1.5–4s (matches the previous
// frontend driver's feel). Capture/void follows after 200–500ms so the
// stream visually reads as "auth lands, then settles."
const (
	demoSimMinIntervalMs = 1500
	demoSimMaxIntervalMs = 4000
	demoSimCaptureMinMs  = 200
	demoSimCaptureMaxMs  = 500
	demoSimCaptureRate   = 0.85 // 85% capture, 15% void
)

// demoSimDescriptions matches the simulation policy's narrative vocabulary
// so the public dashboard's tx stream reads like real fintech activity.
var demoSimDescriptions = []string{
	"Stripe payout settlement",
	"vendor payout — net 30",
	"wire fee — JPMC outbound",
	"card settlement batch",
	"interchange fee capture",
	"ACH debit — payroll run",
	"FX sweep to reserve",
}

// StartDemoSimulator launches the demo-tenant activity goroutine. It runs
// for the lifetime of ctx; callers pass the app's shutdown context so the
// goroutine exits cleanly on SIGTERM. Errors are logged and the loop
// continues — a single failed tick should not silence the whole simulator.
func StartDemoSimulator(ctx context.Context, pool *pgxpool.Pool, br *events.Broadcaster) {
	go func() {
		// Brief warm-up so we don't race the app's first request.
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}

		log.Println("demo simulator: started")
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))

		for {
			delay := time.Duration(demoSimMinIntervalMs+rng.Intn(demoSimMaxIntervalMs-demoSimMinIntervalMs)) * time.Millisecond
			select {
			case <-ctx.Done():
				log.Println("demo simulator: stopping")
				return
			case <-time.After(delay):
			}

			if err := runDemoSimTick(ctx, pool, br, rng); err != nil {
				// Don't spam: log + keep going. A burst of identical errors
				// suggests a real problem; one-off contention is fine.
				log.Printf("demo simulator: tick failed: %v", err)
			}
		}
	}()
}

// runDemoSimTick performs one authorize → capture/void cycle on a random
// pair of demo-tenant accounts in the same currency. Returns early without
// error when the demo tenant lacks two same-currency funded accounts —
// nothing to do, try again next tick.
func runDemoSimTick(ctx context.Context, pool *pgxpool.Pool, br *events.Broadcaster, rng *rand.Rand) error {
	agents, err := ledger.ListAgents(ctx, pool, demoOrgID, ledger.DemoTenantID)
	if err != nil {
		return err
	}

	// Filter to alive agents with a positive balance — we need a funded
	// source. Same-currency dest is picked among remaining alive agents.
	funded := make([]ledger.AgentSummary, 0, len(agents))
	alive := make([]ledger.AgentSummary, 0, len(agents))
	for _, a := range agents {
		if a.Status == ledger.AgentKilled {
			continue
		}
		alive = append(alive, a)
		if a.Balance > 0 {
			funded = append(funded, a)
		}
	}
	if len(funded) == 0 || len(alive) < 2 {
		return nil
	}

	src := funded[rng.Intn(len(funded))]
	sameCcy := make([]ledger.AgentSummary, 0, len(alive))
	for _, a := range alive {
		if a.Currency == src.Currency && a.AccountCode != src.AccountCode {
			sameCcy = append(sameCcy, a)
		}
	}
	if len(sameCcy) == 0 {
		return nil
	}
	dst := sameCcy[rng.Intn(len(sameCcy))]

	// Pick a small slice of the source — 50 minor units floor, up to 4%
	// of balance capped at 50k minor (≈ $500). Keeps the simulator from
	// draining anything quickly.
	cap := src.Balance / 25 // 4%
	if cap > 50_000 {
		cap = 50_000
	}
	if cap < 50 {
		cap = 50
	}
	amount := int64(50 + rng.Intn(int(cap)))

	description := demoSimDescriptions[rng.Intn(len(demoSimDescriptions))]
	auth, err := ledger.Authorize(ctx, pool, demoOrgID, ledger.DemoTenantID,
		src.AccountCode, dst.AccountCode, amount, src.Currency, description)
	if err != nil {
		return err
	}
	_ = br.Publish("auth_created", auth)

	// Brief delay before settlement so the stream shows the auth-then-tx
	// flow rather than collapsing both into one frame.
	settleDelay := time.Duration(demoSimCaptureMinMs+rng.Intn(demoSimCaptureMaxMs-demoSimCaptureMinMs)) * time.Millisecond
	select {
	case <-ctx.Done():
		return nil
	case <-time.After(settleDelay):
	}

	if rng.Float64() < demoSimCaptureRate {
		captured := amount
		if rng.Float64() < 0.15 {
			// 15% partial capture (e.g., 85–99% of the auth) — adds variety
			// and mirrors real-world card settlement behaviour.
			captured = int64(float64(amount) * (0.85 + rng.Float64()*0.14))
			if captured < 1 {
				captured = 1
			}
		}
		posted, err := ledger.Capture(ctx, pool, ledger.DemoTenantID, auth.ID, captured)
		if err != nil {
			return err
		}
		_ = br.Publish("auth_captured", fiber.Map{
			"authorization_id": auth.ID,
			"transaction":      posted,
		})
	} else {
		if err := ledger.Void(ctx, pool, ledger.DemoTenantID, auth.ID); err != nil {
			return err
		}
		_ = br.Publish("auth_voided", fiber.Map{"authorization_id": auth.ID})
	}
	return nil
}
