"use client";

import { useEffect, useRef, useState } from "react";

export type Currency = "USD" | "EUR" | "INR" | "GBP";

export type FlashState = "up" | "down" | "hold" | null;

export type SimAgent = {
  id: string;
  code: string; // A-1, A-2, ...
  name: string; // researcher, analyst, ...
  currency: Currency;
  symbol: string; // $, €, ₹, £
  balance: number; // minor units
  available: number;
  on_hold: number;
  history: number[]; // 24 sparkline samples (most recent last)
  tx24h: number;
  burnPerHr: number; // major units / hr
  flash: FlashState;
  flashUntil: number;
  active: boolean;
  alive: boolean;
};

export type SimTx = {
  id: string;
  agentCode: string;
  agentName: string;
  vendor: string;
  amount: number; // minor units
  currency: Currency;
  symbol: string;
  direction: "in" | "out" | "hold" | "split";
  status: "pending" | "captured" | "voided";
  hash: string;
  block: number;
  ts: number;
  ageMs: number;
  tokens?: number;
  meta?: string; // "tokens · 8.4k", "↗ refund", "rate 1.27"
};

const VENDORS = ["openai", "anthropic", "exa", "deepl", "perplex", "mistral"];
const SYMBOLS: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  INR: "₹",
  GBP: "£",
};
// Rough FX → USD (minor → minor). Fixed for the demo.
const FX_TO_USD: Record<Currency, number> = {
  USD: 1,
  EUR: 1.08,
  INR: 0.012,
  GBP: 1.26,
};

const SEED_AGENTS: Omit<
  SimAgent,
  "flash" | "flashUntil" | "active" | "history" | "tx24h" | "burnPerHr" | "alive"
>[] = [
  { id: "a1", code: "A-1", name: "researcher", currency: "USD", symbol: "$", balance: 4793, available: 4793, on_hold: 0 },
  { id: "a2", code: "A-2", name: "analyst", currency: "EUR", symbol: "€", balance: 3117, available: 2984, on_hold: 133 },
  { id: "a3", code: "A-3", name: "writer", currency: "INR", symbol: "₹", balance: 246100, available: 246100, on_hold: 34000 },
  { id: "a4", code: "A-4", name: "coder", currency: "USD", symbol: "$", balance: 5131, available: 5131, on_hold: 0 },
  { id: "a5", code: "A-5", name: "translator", currency: "EUR", symbol: "€", balance: 1870, available: 1870, on_hold: 0 },
];

function seedAgents(): SimAgent[] {
  return SEED_AGENTS.map((a, i) => ({
    ...a,
    history: synthHistory(24, a.balance, i),
    tx24h: 60 + Math.floor(Math.random() * 380),
    burnPerHr: 0.3 + Math.random() * 2.0,
    flash: null,
    flashUntil: 0,
    active: i === 2, // A-3 writer starts active
    alive: true,
  }));
}

function synthHistory(n: number, current: number, seed: number): number[] {
  const out: number[] = [];
  let v = current * (1.05 + (seed % 3) * 0.08);
  for (let i = 0; i < n; i++) {
    v = v * (0.985 + Math.random() * 0.025);
    out.push(Math.round(v));
  }
  out[n - 1] = current;
  return out;
}

function randHash(): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 4; i++) s += hex[Math.floor(Math.random() * 16)];
  s += "…";
  for (let i = 0; i < 4; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

function pickVendor(currency: Currency): string {
  if (currency === "INR") return Math.random() < 0.5 ? "openai" : "deepl";
  return VENDORS[Math.floor(Math.random() * VENDORS.length)];
}

function spendForCurrency(c: Currency): number {
  // minor units, kept small so demo balances last
  switch (c) {
    case "INR":
      return 5 + Math.floor(Math.random() * 90); // ₹0.05 – ₹0.95 worth (in minor — actually rupees not paise here)
    case "USD":
    case "EUR":
    case "GBP":
      return 5 + Math.floor(Math.random() * 95); // $0.05 – $0.95
  }
}

export type SimState = {
  agents: SimAgent[];
  txs: SimTx[];
  block: number;
  totalUsd: number; // minor units, USD
  totalFlash: FlashState;
  startedAt: number;
};

const FLASH_MS = 900;

export function useSimulator(): SimState {
  const [agents, setAgents] = useState<SimAgent[]>(seedAgents);
  const [txs, setTxs] = useState<SimTx[]>([]);
  const [block, setBlock] = useState(1284562);
  const [totalFlash, setTotalFlash] = useState<FlashState>(null);
  const startedAtRef = useRef<number>(Date.now());
  const lastTotalFlashRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    function schedule() {
      const delay = 700 + Math.random() * 1500;
      const id = setTimeout(() => {
        if (cancelled) return;
        tick();
        schedule();
      }, delay);
      return id;
    }

    function tick() {
      const now = Date.now();
      const idx = Math.floor(Math.random() * SEED_AGENTS.length);
      const isRefund = Math.random() < 0.15;
      const isFx = Math.random() < 0.06;

      setAgents((prev) => {
        const next = prev.map((a) => ({ ...a }));
        const a = next[idx];
        if (!a.alive) return prev;

        const amount = spendForCurrency(a.currency);
        const vendor = pickVendor(a.currency);
        const direction: SimTx["direction"] = isRefund ? "in" : isFx ? "out" : Math.random() < 0.7 ? "split" : "out";

        // Update balance
        if (isRefund) {
          a.balance += amount;
          a.available += amount;
          a.flash = "up";
        } else {
          // First mark as hold (auth), then flash down (capture)
          a.balance -= amount;
          a.on_hold = Math.max(0, a.on_hold - Math.floor(amount * 0.1));
          a.available = Math.max(0, a.available - amount);
          a.flash = direction === "split" ? "hold" : "down";
        }
        a.flashUntil = now + FLASH_MS;
        a.active = true;
        a.tx24h += 1;

        // Sparkline rolling sample
        a.history = [...a.history.slice(1), a.balance];

        // Emit transaction
        const tx: SimTx = {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          agentCode: a.code,
          agentName: a.name,
          vendor,
          amount,
          currency: a.currency,
          symbol: a.symbol,
          direction,
          status: direction === "split" ? "captured" : "captured",
          hash: randHash(),
          block: 0, // filled below
          ts: now,
          ageMs: 0,
          tokens: isRefund || isFx ? undefined : Math.floor(2 + Math.random() * 18) * 1000,
          meta: isRefund
            ? "↗ refund"
            : isFx
              ? `rate ${(0.9 + Math.random() * 0.4).toFixed(2)}`
              : `tokens · ${(2 + Math.random() * 18).toFixed(1)}k`,
        };

        setBlock((b) => {
          tx.block = b + 1;
          return b + 1;
        });

        setTxs((tprev) => [tx, ...tprev].slice(0, 30));

        // Total flash gate
        if (now - lastTotalFlashRef.current > 600) {
          setTotalFlash(isRefund ? "up" : "down");
          lastTotalFlashRef.current = now;
          setTimeout(() => setTotalFlash(null), FLASH_MS);
        }

        // Cool other agents from active back to non-active
        next.forEach((other, i) => {
          if (i !== idx && other.active && Math.random() < 0.4) {
            other.active = false;
          }
        });
        return next;
      });
    }

    schedule();

    // Flash decay loop — clears flash state on each agent past flashUntil
    const decay = setInterval(() => {
      const now = Date.now();
      setAgents((prev) =>
        prev.some((a) => a.flash && now > a.flashUntil)
          ? prev.map((a) =>
              a.flash && now > a.flashUntil ? { ...a, flash: null } : a,
            )
          : prev,
      );
    }, 200);

    return () => {
      cancelled = true;
      clearInterval(decay);
    };
  }, []);

  // Tx age refresh — re-render every second so "02s, 04s" age labels stay live
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Compute USD total
  const totalUsd = agents.reduce(
    (acc, a) => acc + a.balance * FX_TO_USD[a.currency],
    0,
  );

  // Annotate tx ages
  const now = Date.now();
  const txsWithAge = txs.map((t) => ({ ...t, ageMs: now - t.ts }));

  return {
    agents,
    txs: txsWithAge,
    block,
    totalUsd,
    totalFlash,
    startedAt: startedAtRef.current,
  };
}

export function fmtMinor(minor: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(minor / 100);
}

export function fmtAge(ms: number): string {
  if (ms < 1000) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s.toString().padStart(2, "0")}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export { SYMBOLS, FX_TO_USD };
