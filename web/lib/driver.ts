"use client";

import { useEffect } from "react";

import { api, ApiError } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { useStore } from "@/lib/store";

const DEMO_AGENTS: { name: string; currency: string; fundMinor: number }[] = [
  { name: "researcher", currency: "USD", fundMinor: 5000 },
  { name: "analyst",    currency: "EUR", fundMinor: 4500 },
  { name: "writer",     currency: "INR", fundMinor: 350000 },
  { name: "coder",      currency: "USD", fundMinor: 6500 },
  { name: "translator", currency: "EUR", fundMinor: 3000 },
];

// Real-business counterparties that any SaaS would pay — infra, payments,
// communications, dev tools. Reads as legit fintech spend rather than
// "AI agent buying tokens." Mixed across regions to match the multi-
// currency seed accounts.
const VENDORS = [
  "aws", "stripe", "vercel", "wise", "linear",
  "figma", "twilio", "datadog", "github", "mailgun",
  "razorpay", "zoho",
];

function vendorPool(currency: string): string {
  return `treasury_pool_${currency.toLowerCase()}`;
}
function vendorPayee(currency: string): string {
  return `vendor_pool_${currency.toLowerCase()}`;
}

export function useSpendDriver() {
  const apiKey = useApiKey((s) => s.apiKey);
  useEffect(() => {
    // Self mode (user signed in): pause the simulator entirely. The user
    // creates their own activity via curl with their Bearer key. The
    // simulator drives the demo tenant only; running it under the user's
    // Bearer would 404 on demo account_codes.
    if (apiKey) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function bootstrap() {
      try {
        let existing = await api.listAgents();
        const aliveExisting = existing.filter((a) => a.status !== "killed");

        if (aliveExisting.length === 0) {
          // Spawn the demo crew (sequentially to keep ordering).
          for (const def of DEMO_AGENTS) {
            if (cancelled) return;
            try {
              await api.spawnAgent({ name: def.name, currency: def.currency });
            } catch (e) {
              if (e instanceof ApiError && e.code === "agent_exists") {
                /* fine */
              } else {
                throw e;
              }
            }
          }
          existing = (await api.listAgents()).filter(
            (a) => a.status !== "killed",
          );
        } else {
          existing = aliveExisting;
        }

        // Hydrate balances + fund anyone at zero.
        const balances: Record<string, Awaited<ReturnType<typeof api.getBalance>>> = {};
        for (const a of existing) {
          if (cancelled) return;
          try {
            balances[a.account_code] = await api.getBalance(a.account_code);
          } catch {
            /* ignore missing balance */
          }
        }

        useStore.getState().initFromBackend(existing, balances);

        // Fund any agent at 0 balance from the matching treasury pool.
        for (const a of existing) {
          if (cancelled) return;
          const bal = balances[a.account_code];
          if (bal && bal.balance > 0) continue;
          const def = DEMO_AGENTS.find((d) => d.name === a.name);
          const fund = def?.fundMinor ?? 5000;
          try {
            await api.postTransaction(
              {
                description: `bootstrap funding · ${a.name}`,
                occurred_at: new Date().toISOString(),
                entries: [
                  {
                    account: vendorPool(a.currency),
                    amount: fund,
                    currency: a.currency,
                    direction: "out",
                  },
                  {
                    account: a.account_code,
                    amount: fund,
                    currency: a.currency,
                    direction: "in",
                  },
                ],
              },
              `bootstrap-${a.id}`,
            );
            // Refresh that agent's balance into the store.
            const fresh = await api.getBalance(a.account_code);
            useStore.getState().setBalance(a.account_code, fresh);
          } catch (e) {
            // Idempotency replay or already-funded — ignore.
            void e;
          }
        }
      } catch (e) {
        // Backend not reachable — driver becomes a no-op.
        console.warn("[driver] bootstrap failed:", e);
        return;
      }

      if (!cancelled) loop();
    }

    function loop() {
      const delay = 1200 + Math.random() * 2400;
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await tick();
        if (!cancelled) loop();
      }, delay);
    }

    async function tick() {
      const { agents } = useStore.getState();
      const alive = agents.filter((a) => a.balance > 0 && a.status !== "killed");
      if (alive.length === 0) return;
      const a = alive[Math.floor(Math.random() * alive.length)];

      // Spend a small chunk — clamp so we don't drain in one shot.
      const max = Math.min(Math.floor(a.balance * 0.05), 200);
      const amount = Math.max(5, Math.floor(Math.random() * max));
      const vendor = VENDORS[Math.floor(Math.random() * VENDORS.length)];

      try {
        const auth = await api.authorize({
          source: a.accountCode,
          dest: vendorPayee(a.currency),
          amount,
          currency: a.currency,
          description: `cp:${vendor} · ${a.name} call`,
        });
        // 88% capture, 12% void
        await sleep(180 + Math.random() * 320);
        if (Math.random() < 0.88) {
          const captureAmount = Math.max(
            1,
            Math.floor(amount * (0.85 + Math.random() * 0.14)),
          );
          await api.capture(auth.id, captureAmount);
        } else {
          await api.voidAuth(auth.id);
        }
      } catch (e) {
        console.warn("[driver] spend cycle failed:", e);
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiKey]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
