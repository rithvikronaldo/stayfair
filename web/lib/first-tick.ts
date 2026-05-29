"use client";

import { useEffect } from "react";

import { api } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { useStore } from "@/lib/store";

// useFirstTick is The First Tick — a tenant-aware driver that keeps a freshly
// signed-up dashboard alive for the first 5 minutes, so the user's very first
// paint already has money moving rather than a static seed. The demo's
// useSpendDriver can't do this: it hard-codes demo account codes
// (treasury_pool_usd, …) and pauses entirely in self mode. This one reads the
// user's own accounts from the store and posts real authorize → capture/void
// cycles between same-currency pairs, applied optimistically so the stream and
// balances move instantly (self-mode polling is only every 5s).
//
// The window is gated against the tenant's server-side `created_at` so it
// can't restart on a key rotation (re-signup with an existing email returns a
// fresh key bound to the old tenant) and won't fire for an old tenant signed
// into a fresh browser.

const WINDOW_MS = 5 * 60_000;

const DESCRIPTIONS = [
  "Stripe payout settlement",
  "vendor payout — net 30",
  "wire fee — JPMC outbound",
  "card settlement batch",
  "interchange fee capture",
  "ACH debit — payroll run",
  "FX sweep to reserve",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

export function useFirstTick() {
  const apiKey = useApiKey((s) => s.apiKey);
  const tenantCreatedAt = useApiKey((s) => s.tenantCreatedAt);
  const asOf = useStore((s) => s.asOf);

  useEffect(() => {
    if (!apiKey) return; // signed-in tenants only
    if (asOf !== null) return; // never generate activity during replay
    if (!tenantCreatedAt) return; // legacy session w/o created_at — opt out

    const start = new Date(tenantCreatedAt).getTime();
    if (Number.isNaN(start)) return;
    if (Date.now() - start > WINDOW_MS) return; // tenant older than the window

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const withinWindow = () => Date.now() - start < WINDOW_MS;

    async function tick() {
      const { agents } = useStore.getState();
      const alive = agents.filter((a) => a.status !== "killed");
      const funded = alive.filter((a) => a.balance > 0);
      if (funded.length === 0) return;

      const source = pick(funded);
      const sameCcy = alive.filter(
        (a) =>
          a.currency === source.currency && a.accountCode !== source.accountCode,
      );
      if (sameCcy.length === 0) return;
      const dest = pick(sameCcy);

      // Spend a small slice so balances drift rather than empty out.
      const cap = Math.min(Math.floor(source.balance * 0.04), 50_000);
      const amount = Math.max(50, Math.floor(Math.random() * Math.max(cap, 50)));

      try {
        const auth = await api.authorize({
          source: source.accountCode,
          dest: dest.accountCode,
          amount,
          currency: source.currency,
          description: pick(DESCRIPTIONS),
        });
        useStore.getState().applyAuthCreated(auth);

        await sleep(200 + Math.random() * 300);
        if (cancelled) return;

        if (Math.random() < 0.85) {
          const captured = Math.max(
            1,
            Math.floor(amount * (0.85 + Math.random() * 0.15)),
          );
          const res = await api.capture(auth.id, captured);
          useStore
            .getState()
            .applyAuthCaptured(res.authorization_id, res.transaction);
        } else {
          await api.voidAuth(auth.id);
          useStore.getState().applyAuthVoided(auth.id);
        }
      } catch {
        // Tolerate transient failures — the driver is decorative.
      }
    }

    function loop() {
      const delay = 1500 + Math.random() * 2500;
      timeoutId = setTimeout(async () => {
        if (cancelled || !withinWindow()) return;
        await tick();
        if (!cancelled && withinWindow()) loop();
      }, delay);
    }

    // Start after a short beat so self-mode polling can hydrate accounts first.
    timeoutId = setTimeout(() => {
      if (!cancelled && withinWindow()) loop();
    }, 1200);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiKey, tenantCreatedAt, asOf]);
}
