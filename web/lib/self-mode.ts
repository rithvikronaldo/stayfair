"use client";

import { useEffect, useRef } from "react";

import { api } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { useStore } from "@/lib/store";

// useSelfModePolling drives the dashboard agents/balances refresh loop.
// Runs in BOTH modes:
//   - Self mode (apiKey set): polls every 5s, drives the user's own tenant.
//   - Demo mode (no apiKey):  polls every 5s, drives the public demo tenant
//     so the agents pane + hero number populate on anonymous visits. The
//     simulator (server-side) continues to emit auth_* events via SSE which
//     useEventStream applies as deltas; this loop is the source-of-truth
//     correction every 5s.
//
// SSE is the demo's real-time pipe; in self mode SSE is disabled because
// event payloads don't carry tenant_id yet (W6 carryover) and a connected
// stream would leak demo activity into the user's view.
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

  // Polling: pauses during replay (asOf set) so the rewound view doesn't get
  // clobbered by live data. Resumes on snap-to-NOW. Runs in both modes.
  useEffect(() => {
    if (asOf !== null) return;

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
      // One-time backfills per tenant:
      //   (a) the feed gets the 30 most-recent txns so the stream isn't empty
      //       on first paint;
      //   (b) the agent cards get tx24h / burnPerHr computed from the last
      //       24h (up to the 1000 hard cap) — without this both fields stay
      //       at 0 in self mode because they're hardcoded in initFromBackend.
      // Guarded so this fires once per sign-in, not on every LIVE resume.
      if (!backfilledRef.current) {
        backfilledRef.current = true;
        api
          .listTransactions({ limit: 30 })
          .then((page) => {
            if (!cancelled) useStore.getState().hydrateTxStream(page.transactions);
          })
          .catch(() => {});

        const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
        api
          .listTransactions({ from: dayAgo, limit: 1000 })
          .then((page) => {
            if (!cancelled) useStore.getState().recomputeAccountStats(page.transactions);
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
