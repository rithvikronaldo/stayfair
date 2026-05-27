"use client";

import { useEffect, useRef } from "react";

import { api } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { useStore } from "@/lib/store";

// useSelfModePolling drives the dashboard when the user is signed in.
//
// SSE is disabled in self mode because event payloads don't carry tenant_id
// yet (W6 carryover); a connected stream would leak demo activity. Instead
// this polls /agents (every 5s) and pulls a fresh balance per agent.
//
// CRITICAL (W6 D2 fix): reset()/setMode are keyed on apiKey ALONE. They must
// NOT run when asOf changes — entering replay sets asOf, and a reset() there
// would wipe asOf + agents + txs and tear the replay down the instant it
// starts (the bug that made replay "flash and snap back" in self mode).
export function useSelfModePolling() {
  const apiKey = useApiKey((s) => s.apiKey);
  const asOf = useStore((s) => s.asOf);
  const backfilledRef = useRef(false);

  // Tenant change only: wipe data, flip mode, re-arm the one-time backfill.
  useEffect(() => {
    useStore.getState().reset();
    useStore.getState().setMode(apiKey ? "self" : "demo");
    backfilledRef.current = false;
  }, [apiKey]);

  // Polling: active only when signed in AND live (asOf === null). Entering
  // replay (asOf !== null) tears this down and pauses; returning to LIVE
  // resumes it. No reset() here — replay state is left untouched.
  useEffect(() => {
    if (!apiKey || asOf !== null) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function refreshOnce() {
      if (cancelled) return;
      try {
        const agents = await api.listAgents();
        const balances: Record<string, Awaited<ReturnType<typeof api.getBalance>>> = {};
        for (const a of agents) {
          if (cancelled) return;
          try {
            balances[a.account_code] = await api.getBalance(a.account_code);
          } catch {
            /* tolerate per-account miss */
          }
        }
        if (!cancelled) useStore.getState().initFromBackend(agents, balances);
      } catch (e) {
        console.warn("[self-mode] refresh failed:", e);
      }
    }

    function loop() {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await refreshOnce();
        if (!cancelled) loop();
      }, 5000);
    }

    refreshOnce().then(() => {
      if (cancelled) return;
      // One-time history backfill per tenant: the seed leaves ~100 txns in the
      // DB that feed balances but never the stream, so the feed reads empty on
      // first paint. Pull recent ones in (balance-neutral) so the dashboard is
      // populated on arrival. Guarded so it fires once, not on every LIVE
      // resume after a replay.
      if (!backfilledRef.current) {
        backfilledRef.current = true;
        api
          .listTransactions({ limit: 30 })
          .then((page) => {
            if (!cancelled) useStore.getState().hydrateTxStream(page.transactions);
          })
          .catch(() => {});
      }
      loop();
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiKey, asOf]);
}
