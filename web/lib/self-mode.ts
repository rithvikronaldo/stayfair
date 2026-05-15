"use client";

import { useEffect } from "react";

import { api } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { useStore } from "@/lib/store";

// useSelfModePolling drives the dashboard when the user is signed in.
//
// SSE is disabled in self mode because event payloads don't carry
// tenant_id yet (W6 carryover); a connected stream would leak demo
// activity. Instead this hook polls /agents (every 5s) and pulls a
// fresh balance per agent — enough to reflect a user's curl-posted
// transaction within ~5s of it landing.
//
// On apiKey change (sign-in or sign-out), the store is reset, the mode
// flips, and either this hook or the SSE/driver hooks take over.
export function useSelfModePolling() {
  const apiKey = useApiKey((s) => s.apiKey);

  useEffect(() => {
    const setMode = useStore.getState().setMode;
    const reset = useStore.getState().reset;
    const initFromBackend = useStore.getState().initFromBackend;

    // Tenant change: wipe demo data, flip mode.
    reset();
    setMode(apiKey ? "self" : "demo");

    if (!apiKey) return; // demo mode is handled by driver + SSE

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
        if (!cancelled) initFromBackend(agents, balances);
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
      if (!cancelled) loop();
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiKey]);
}
