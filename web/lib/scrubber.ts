"use client";

import { useEffect } from "react";

import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

// useScrubberRewind watches the store's `asOf` field and rewinds every
// agent's balance to its value at that timestamp by calling
// /accounts/:code/balance?as_of=. When `asOf` returns to null (NOW), the
// hook does nothing — the live polling / SSE loops resume control.
//
// The hook does not pause the live loops itself; the live loops gate
// themselves on `asOf === null` (added in driver.ts, event-stream.ts,
// self-mode.ts) to avoid balance-update wars.
//
// One pass per asOf change. No interval — historical balances don't
// move on their own.
export function useScrubberRewind() {
  const asOf = useStore((s) => s.asOf);

  useEffect(() => {
    if (asOf === null) return; // live mode owns balances

    let cancelled = false;

    async function rewindToTimestamp(at: Date) {
      const agents = useStore.getState().agents;
      const asOfISO = at.toISOString();
      const setBalance = useStore.getState().setBalance;

      // Sequential rather than parallel — the backend is local and the
      // number of agents is tiny; this keeps the order stable in dev tools
      // and avoids head-of-line stalls under flaky network.
      for (const a of agents) {
        if (cancelled) return;
        try {
          const balance = await api.getBalance(a.accountCode, {
            as_of: asOfISO,
          });
          if (!cancelled) setBalance(a.accountCode, balance);
        } catch {
          // tolerate per-account miss (e.g. an account that didn't yet
          // exist at the requested as_of returns an error or 404)
        }
      }
    }

    rewindToTimestamp(asOf);

    return () => {
      cancelled = true;
    };
  }, [asOf]);
}
