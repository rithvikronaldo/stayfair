"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { api, type Balance, type StressResult } from "@/lib/api";
import { useStore } from "@/lib/store";

// useStressRun drives the stress test as REAL batched progress (W6 D2 rework).
//
// The old version fired one synchronous POST /stress and, with no progress to
// show, drew a fake extrapolated line — a gimmick. This version posts N in
// several real batches: the count only advances after each batch actually
// commits, so the climbing line/number is genuine. Between batches we pull the
// just-committed rows into the feed (proof they landed), and on completion we
// refresh balances so the accounts visibly jump to their new values.
//
// Aggregate stats are honest: throughput is total committed ÷ wall-clock
// elapsed (batch overhead included), invariant violations / retries are summed,
// commit-latency percentiles are blended across batches. The single-shot
// backend path (api.stress with concurrency) stays available for clean blog
// measurement via curl.

export const STRESS_DEFAULT_N = 1000;

// Aim for ~12 visible steps so the climb reads smooth without flooding the
// API with round-trips; never go below a floor so tiny runs aren't chatty.
const TARGET_BATCHES = 12;
const MIN_BATCH = 50;

export type UseStressApi = {
  run: (n?: number) => Promise<void>;
  reset: () => void;
};

export function useStressRun(): UseStressApi {
  const run = useCallback(async (n: number = STRESS_DEFAULT_N) => {
    const store = useStore.getState();
    if (store.stressPhase === "running") return;

    store.startStress(n);
    const inSelfMode = store.mode === "self";
    const batchSize = Math.max(MIN_BATCH, Math.ceil(n / TARGET_BATCHES));
    const t0 = performance.now();
    let posted = 0;
    const batches: StressResult[] = [];

    try {
      while (posted < n) {
        // The user closed the modal mid-run — stop cleanly.
        if (useStore.getState().stressPhase !== "running") return;

        const size = Math.min(batchSize, n - posted);
        const res = await api.stress(size);
        posted += res.n_posted;
        batches.push(res);
        useStore
          .getState()
          .advanceStress(posted, (performance.now() - t0) / 1000);

        // Trickle a few freshly-committed rows onto the feed so the user
        // watches real transactions land — a small prepend per batch (not a
        // full 30-row replace) keeps it smooth. Self mode only: in demo the
        // SSE/driver own the feed. Best-effort — never blocks the run.
        if (inSelfMode) {
          try {
            const page = await api.listTransactions({ limit: 4 });
            useStore.getState().pushStressRows(page.transactions);
          } catch {
            /* feed refresh is non-critical */
          }
        }
      }

      const result = aggregate(batches, posted, performance.now() - t0);
      useStore.getState().completeStress(result);

      // Aftermath: refresh balances so the accounts jump to their new values
      // (the count animates via useAnimatedNumber). Self mode only.
      if (inSelfMode) await refreshBalances();
    } catch (err) {
      useStore.getState().resetStress();
      toast.error("stress failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const reset = useCallback(() => {
    useStore.getState().resetStress();
  }, []);

  return { run, reset };
}

// aggregate blends per-batch results into one honest summary.
function aggregate(
  batches: StressResult[],
  posted: number,
  elapsedMs: number,
): StressResult {
  const tps = elapsedMs > 0 ? (posted / elapsedMs) * 1000 : 0;
  const p50s = batches.map((b) => b.p50_commit_ms);
  const last = batches[batches.length - 1];
  return {
    n_posted: posted,
    elapsed_ms: Math.round(elapsedMs),
    tps_peak: tps,
    // median of batch medians ≈ typical commit; worst batch p99 = headline tail.
    p50_commit_ms: median(p50s),
    p99_commit_ms: batches.length ? Math.max(...batches.map((b) => b.p99_commit_ms)) : 0,
    invariant_violations: batches.reduce((a, b) => a + b.invariant_violations, 0),
    serialization_retries: batches.reduce((a, b) => a + b.serialization_retries, 0),
    currency: last?.currency ?? "",
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// refreshBalances re-pulls agents + balances and rehydrates the store, the same
// path self-mode polling uses — so the accounts snap to their post-stress
// values immediately instead of waiting for the next 5s poll.
async function refreshBalances(): Promise<void> {
  try {
    const agents = await api.listAgents();
    const balances: Record<string, Balance> = {};
    for (const a of agents) {
      try {
        balances[a.account_code] = await api.getBalance(a.account_code);
      } catch {
        /* tolerate a per-account miss */
      }
    }
    useStore.getState().initFromBackend(agents, balances);
  } catch {
    /* balance refresh is best-effort; the 5s poll will catch up */
  }
}
