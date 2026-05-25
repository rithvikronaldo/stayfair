package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"slices"
	"strconv"
	"sync"
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
// isolation (read-committed). The default run is sequential (concurrency = 1)
// — that's the path the headline blog numbers (582/518/325 tps across
// 1k/5k/10k) were measured on, and it stays byte-for-byte unchanged. Passing
// "concurrency" > 1 fans the N posts across that many goroutines, each on its
// own pooled connection, to push throughput toward the 10k-tps target and
// surface real serialization-retry rates under contention. Per-tx 40001
// failures are retried (cap stressMaxRetries) and, if still contended, the tx
// is skipped — so n_posted may trail the requested N rather than failing the
// whole run.
//
// NOTE (W6 D1, DB-blocked): the concurrent path compiles and preserves the
// sequential default, but its actual tps/retry numbers are unmeasured until
// local Postgres is reachable. Measure before quoting concurrent figures.

const (
	stressMaxN           = 10_000
	stressDefaultN       = 1_000
	stressMaxRetries     = 3
	stressMaxConcurrency = 64
)

type stressRequest struct {
	N           int `json:"n"`
	Concurrency int `json:"concurrency"`
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
		concurrency := 1
		if len(c.Body()) > 0 {
			var req stressRequest
			if err := json.Unmarshal(c.Body(), &req); err == nil {
				if req.N > 0 {
					n = req.N
				}
				if req.Concurrency > 0 {
					concurrency = req.Concurrency
				}
			}
		}
		if qn := c.Query("n"); qn != "" {
			if parsed, err := strconv.Atoi(qn); err == nil && parsed > 0 {
				n = parsed
			}
		}
		if qc := c.Query("concurrency"); qc != "" {
			if parsed, err := strconv.Atoi(qc); err == nil && parsed > 0 {
				concurrency = parsed
			}
		}
		if n > stressMaxN {
			n = stressMaxN
		}
		if concurrency > stressMaxConcurrency {
			concurrency = stressMaxConcurrency
		}
		if concurrency > n {
			concurrency = n
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

		runStart := time.Now()
		agg := runStress(ctx, pool, demoOrgID, tenantID, codes, usableCcy, n, concurrency)
		if agg.termErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":                "stress_post_failed",
				"message":              agg.termErr.Error(),
				"i":                    agg.termI,
				"n_posted_before_fail": agg.nPosted,
			})
		}

		elapsed := time.Since(runStart)
		latencies := agg.latencies
		retries := agg.retries
		nPosted := agg.nPosted
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

// stressAgg accumulates the outcome of a stress run — merged across workers in
// the concurrent path, used directly in the sequential one.
type stressAgg struct {
	latencies []time.Duration
	retries   int
	nPosted   int
	termErr   error // first terminal (non-40001) error encountered, if any
	termI     int   // index that produced termErr
}

// runStress posts n balanced synthetic transactions across the given account
// codes. concurrency <= 1 runs the proven sequential loop; > 1 fans the work
// across that many goroutines (each on its own pooled connection) and merges
// their results. Index i is partitioned round-robin so workers don't collide
// on the same i, and each worker seeds its own rng.
func runStress(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, tenantID uuid.UUID,
	codes []string,
	ccy string,
	n, concurrency int,
) stressAgg {
	if concurrency <= 1 {
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))
		var agg stressAgg
		agg.latencies = make([]time.Duration, 0, n)
		for i := range n {
			runStressOne(ctx, pool, orgID, tenantID, codes, ccy, rng, i, &agg)
			if agg.termErr != nil {
				return agg
			}
		}
		return agg
	}

	// Concurrent path. Each worker handles indices w, w+W, w+2W, … and writes
	// to its own slot, so no shared-state locking is needed during the run.
	// A terminal error on any worker cancels the rest.
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make([]stressAgg, concurrency)
	var wg sync.WaitGroup
	for w := range concurrency {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			rng := rand.New(rand.NewSource(time.Now().UnixNano() + int64(w)*7919))
			agg := &results[w]
			for i := w; i < n; i += concurrency {
				if runCtx.Err() != nil {
					return
				}
				runStressOne(runCtx, pool, orgID, tenantID, codes, ccy, rng, i, agg)
				if agg.termErr != nil {
					cancel()
					return
				}
			}
		}(w)
	}
	wg.Wait()

	var merged stressAgg
	for i := range results {
		r := &results[i]
		merged.latencies = append(merged.latencies, r.latencies...)
		merged.retries += r.retries
		merged.nPosted += r.nPosted
		if r.termErr != nil && merged.termErr == nil {
			merged.termErr = r.termErr
			merged.termI = r.termI
		}
	}
	return merged
}

// runStressOne posts a single synthetic transaction with serialization-retry,
// recording the outcome into agg. A 40001 contention failure that survives
// stressMaxRetries is skipped (not counted in nPosted, no terminal error). A
// context cancellation (a sibling worker failed) is silently dropped. Any
// other error is recorded as terminal.
func runStressOne(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, tenantID uuid.UUID,
	codes []string,
	ccy string,
	rng *rand.Rand,
	i int,
	agg *stressAgg,
) {
	ai := rng.Intn(len(codes))
	bi := rng.Intn(len(codes) - 1)
	if bi >= ai {
		bi++
	}

	// Amounts in [100, 10_100) minor units — readable but not so uniform that
	// the dashboard looks fake.
	amount := int64(100) + rng.Int63n(10_000)
	tx := ledger.Transaction{
		Description: fmt.Sprintf("stress synthetic %d", i),
		OccurredAt:  time.Now().UTC(),
		Entries: []ledger.Entry{
			{Account: codes[ai], Amount: amount, Currency: ccy, Direction: ledger.DirOut},
			{Account: codes[bi], Amount: amount, Currency: ccy, Direction: ledger.DirIn},
		},
	}

	for range stressMaxRetries {
		start := time.Now()
		_, err := ledger.Post(ctx, pool, orgID, tenantID, tx)
		if err == nil {
			agg.latencies = append(agg.latencies, time.Since(start))
			agg.nPosted++
			return
		}
		// Sibling worker already failed and cancelled us — bow out quietly.
		if ctx.Err() != nil {
			return
		}
		// Retry on Postgres serialization failure (40001); everything else is
		// terminal.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "40001" {
			agg.retries++
			continue
		}
		agg.termErr = err
		agg.termI = i
		return
	}
	// 40001 retries exhausted — skip this tx, leave n_posted short.
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
