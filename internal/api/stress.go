package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"slices"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rithvikronaldo/acta/internal/events"
	"github.com/rithvikronaldo/acta/internal/ledger"
)

// Stress bulk-posts N balanced double-entry transactions through the
// existing ledger.Post() primitive. Each transaction picks two random
// accounts of the same currency from the calling tenant's active set,
// debits one and credits the other in matching amounts. The invariant is
// enforced inside Post (unbalanced → error), so the response's
// invariant_violations is structurally zero — it ships as an explicit
// field for the dashboard to display, not as a calculated metric.
//
// Isolation: each Post opens its own pgx transaction at the pool's default
// isolation (read-committed). Sequential loop means no inter-tx contention
// to worry about for the MVP. Upgrading to concurrent SERIALIZABLE goroutines
// for true contention measurements is W6 D1 polish work — the headline
// blog numbers come from this sequential run first.

const (
	stressMaxN       = 10_000
	stressDefaultN   = 1_000
	stressMaxRetries = 3
)

type stressRequest struct {
	N int `json:"n"`
}

type stressResponse struct {
	NPosted              int     `json:"n_posted"`
	ElapsedMs            int64   `json:"elapsed_ms"`
	TpsPeak              float64 `json:"tps_peak"`
	P99CommitMs          float64 `json:"p99_commit_ms"`
	P50CommitMs          float64 `json:"p50_commit_ms"`
	InvariantViolations  int     `json:"invariant_violations"`
	SerializationRetries int     `json:"serialization_retries"`
	Currency             string  `json:"currency"`
}

// PostStress handles POST /stress. Body { "n": 1000 } or ?n=1000.
// Caps at stressMaxN. Returns headline perf stats + 0 invariant violations.
func PostStress(pool *pgxpool.Pool, broadcaster *events.Broadcaster) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ctx := c.Context()

		n := stressDefaultN
		if len(c.Body()) > 0 {
			var req stressRequest
			if err := json.Unmarshal(c.Body(), &req); err == nil && req.N > 0 {
				n = req.N
			}
		}
		if qn := c.Query("n"); qn != "" {
			if parsed, err := strconv.Atoi(qn); err == nil && parsed > 0 {
				n = parsed
			}
		}
		if n > stressMaxN {
			n = stressMaxN
		}

		tenantID := TenantID(c)

		accts, err := listStressAccounts(ctx, pool, demoOrgID, tenantID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "list_accounts_failed", "message": err.Error(),
			})
		}
		// Group by currency; need at least 2 accounts of the same currency
		// to form a balanced pair.
		byCcy := map[string][]string{}
		for _, a := range accts {
			byCcy[a.currency] = append(byCcy[a.currency], a.code)
		}
		var usableCcy string
		var codes []string
		for ccy, list := range byCcy {
			if len(list) >= 2 {
				usableCcy = ccy
				codes = list
				break
			}
		}
		if len(codes) < 2 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "no_currency_pair",
				"message": "tenant needs at least two active accounts of the same currency to stress",
			})
		}

		rng := rand.New(rand.NewSource(time.Now().UnixNano()))
		latencies := make([]time.Duration, 0, n)
		retries := 0
		nPosted := 0

		runStart := time.Now()

		for i := range n {
			ai := rng.Intn(len(codes))
			bi := rng.Intn(len(codes) - 1)
			if bi >= ai {
				bi++
			}
			from := codes[ai]
			to := codes[bi]

			// Amounts in [100, 10_100) minor units — readable but not so
			// uniform that the dashboard looks fake.
			amount := int64(100) + rng.Int63n(10_000)
			occurredAt := time.Now().UTC()

			tx := ledger.Transaction{
				Description: fmt.Sprintf("stress synthetic %d", i),
				OccurredAt:  occurredAt,
				Entries: []ledger.Entry{
					{Account: from, Amount: amount, Currency: usableCcy, Direction: ledger.DirOut},
					{Account: to, Amount: amount, Currency: usableCcy, Direction: ledger.DirIn},
				},
			}

			var postErr error
			for range stressMaxRetries {
				postStart := time.Now()
				_, err := ledger.Post(ctx, pool, demoOrgID, tenantID, tx)
				postEnd := time.Now()
				if err == nil {
					latencies = append(latencies, postEnd.Sub(postStart))
					nPosted++
					postErr = nil
					break
				}
				// Retry on Postgres serialization failure (40001). Other errors
				// are terminal — return immediately with whatever we got.
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == "40001" {
					retries++
					continue
				}
				postErr = err
				break
			}
			if postErr != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error":                "stress_post_failed",
					"message":              postErr.Error(),
					"i":                    i,
					"n_posted_before_fail": nPosted,
				})
			}
		}

		elapsed := time.Since(runStart)
		slices.Sort(latencies)

		tps := 0.0
		if elapsed.Seconds() > 0 {
			tps = float64(nPosted) / elapsed.Seconds()
		}

		resp := stressResponse{
			NPosted:              nPosted,
			ElapsedMs:            elapsed.Milliseconds(),
			TpsPeak:              round2(tps),
			P99CommitMs:          msFloat(percentile(latencies, 99)),
			P50CommitMs:          msFloat(percentile(latencies, 50)),
			InvariantViolations:  0,
			SerializationRetries: retries,
			Currency:             usableCcy,
		}

		// One event lets live dashboards know to refetch balances; the per-tx
		// stream would drown the SSE channel.
		_ = broadcaster.Publish("stress_completed", resp)

		return c.JSON(resp)
	}
}

type stressAccount struct{ code, currency string }

func listStressAccounts(ctx context.Context, pool *pgxpool.Pool, orgID, tenantID uuid.UUID) ([]stressAccount, error) {
	// House accounts (agent_id IS NULL) plus accounts whose backing agent
	// is still active. Killed agents' accounts are skipped — the row exists
	// but the agent has been soft-deleted, so don't pick it up for new txns.
	rows, err := pool.Query(ctx, `
		SELECT a.code, a.currency
		FROM accounts a
		LEFT JOIN agents ag ON ag.id = a.agent_id
		WHERE a.org_id = $1 AND a.tenant_id = $2
		  AND (ag.id IS NULL OR ag.status = 'active')
	`, orgID, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []stressAccount{}
	for rows.Next() {
		var a stressAccount
		if err := rows.Scan(&a.code, &a.currency); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// percentile returns the p-th percentile of a sorted slice using nearest-rank.
// Caller is responsible for sorting.
func percentile(sorted []time.Duration, p int) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	idx := (p * len(sorted)) / 100
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func msFloat(d time.Duration) float64 {
	return round2(float64(d.Microseconds()) / 1000.0)
}

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}
