"use client";

import { create } from "zustand";

import type {
  Agent,
  AgentSummary,
  Authorization,
  Balance,
  PostedTransaction,
} from "@/lib/api";

export type FlashState = "up" | "down" | "hold" | null;

const FX_TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  INR: 0.012,
  GBP: 1.26,
};
const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  INR: "₹",
  GBP: "£",
};

export type AgentRow = {
  id: string;
  code: string; // visual code, e.g. "A-1"
  accountCode: string;
  name: string;
  currency: string;
  symbol: string;
  status: string;
  balance: number;
  available: number;
  on_hold: number;
  history: number[]; // sparkline
  tx24h: number;
  burnPerHr: number;
  flash: FlashState;
  flashUntil: number;
  active: boolean;
};

export type TxRow = {
  id: string; // local: tx-<authId> or tx-<txId>
  authId?: string;
  txId?: string;
  agentCode: string;
  agentName: string;
  agentAccountCode: string;
  vendor: string;
  amount: number;
  capturedAmount?: number;
  currency: string;
  symbol: string;
  status: "pending" | "captured" | "voided";
  hash: string;
  block: number;
  ts: number;
  meta?: string;
};

export type ViewMode = "demo" | "self";

type State = {
  agents: AgentRow[];
  txs: TxRow[]; // newest first, max 30
  block: number;
  totalUsd: number;
  totalFlash: FlashState;
  totalFlashUntil: number;
  bootstrapped: boolean;
  connected: boolean;
  mode: ViewMode;
};

type Actions = {
  setBootstrapped: (b: boolean) => void;
  setConnected: (b: boolean) => void;
  setMode: (m: ViewMode) => void;
  reset: () => void;

  initFromBackend: (
    agents: AgentSummary[],
    balances: Record<string, Balance>,
  ) => void;
  applyAgentSpawned: (agent: Agent) => void;
  applyAuthCreated: (auth: Authorization) => void;
  applyAuthCaptured: (
    authId: string,
    tx: PostedTransaction,
  ) => void;
  applyAuthVoided: (authId: string) => void;
  setBalance: (accountCode: string, balance: Balance) => void;
  decayFlashes: () => void;
};

const FLASH_MS = 900;

let blockCounter = 1284562;
let agentCounter = 0;

function shortHash(id: string): string {
  const s = id.replace(/-/g, "");
  return "0x" + s.slice(0, 4) + "…" + s.slice(-4);
}

function recomputeTotal(agents: AgentRow[]): number {
  return agents.reduce(
    (acc, a) => acc + a.balance * (FX_TO_USD[a.currency] ?? 1),
    0,
  );
}

function pushHistory(history: number[], next: number): number[] {
  const out = history.slice(-23);
  out.push(next);
  return out;
}

function vendorFromDest(dest: string): string {
  // dest is "vendor_pool_<ccy>" → "pool"
  const m = dest.match(/^vendor_pool_/i);
  if (m) return "vendor:pool";
  if (dest.startsWith("agent_")) return dest.slice(0, 14);
  return dest;
}

function inferVendorFromDescription(desc: string): string {
  const m = desc.match(/(?:cp|vendor):(\w+)/i);
  return m ? m[1] : "pool";
}

export const useStore = create<State & Actions>()((set, get) => ({
  agents: [],
  txs: [],
  block: blockCounter,
  totalUsd: 0,
  totalFlash: null,
  totalFlashUntil: 0,
  bootstrapped: false,
  connected: false,
  mode: "demo",

  setBootstrapped: (b) => set({ bootstrapped: b }),
  setConnected: (b) => set({ connected: b }),
  setMode: (m) => set({ mode: m }),
  reset: () =>
    set({
      agents: [],
      txs: [],
      totalUsd: 0,
      totalFlash: null,
      totalFlashUntil: 0,
      bootstrapped: false,
    }),

  initFromBackend: (agents, balances) => {
    const rows: AgentRow[] = agents.map((a, i) => {
      const bal = balances[a.account_code];
      const balance = bal?.balance ?? a.balance;
      return {
        id: a.id,
        code: `A-${i + 1}`,
        accountCode: a.account_code,
        name: a.name,
        currency: a.currency,
        symbol: SYMBOLS[a.currency] ?? "$",
        status: a.status,
        balance,
        available: bal?.available ?? balance,
        on_hold: bal?.on_hold ?? 0,
        history: Array(24).fill(balance),
        tx24h: 0,
        burnPerHr: 0,
        flash: null,
        flashUntil: 0,
        active: false,
      };
    });
    agentCounter = rows.length;
    set({
      agents: rows,
      totalUsd: recomputeTotal(rows),
      bootstrapped: true,
    });
  },

  applyAgentSpawned: (agent) => {
    const existing = get().agents.find((a) => a.id === agent.id);
    if (existing) return;
    agentCounter += 1;
    const row: AgentRow = {
      id: agent.id,
      code: `A-${agentCounter}`,
      accountCode: agent.account_code,
      name: agent.name,
      currency: agent.currency,
      symbol: SYMBOLS[agent.currency] ?? "$",
      status: agent.status,
      balance: 0,
      available: 0,
      on_hold: 0,
      history: Array(24).fill(0),
      tx24h: 0,
      burnPerHr: 0,
      flash: null,
      flashUntil: 0,
      active: false,
    };
    const agents = [...get().agents, row];
    set({ agents, totalUsd: recomputeTotal(agents) });
  },

  applyAuthCreated: (auth) => {
    const now = Date.now();
    const agents = get().agents.map((a) => {
      if (a.accountCode !== auth.source_account) return a;
      return {
        ...a,
        on_hold: a.on_hold + auth.amount,
        available: Math.max(0, a.available - auth.amount),
        flash: "hold" as FlashState,
        flashUntil: now + FLASH_MS,
        active: true,
      };
    });

    blockCounter += 1;
    const sourceAgent = get().agents.find(
      (a) => a.accountCode === auth.source_account,
    );
    const tx: TxRow = {
      id: `tx-${auth.id}`,
      authId: auth.id,
      agentCode: sourceAgent?.code ?? "?",
      agentName: sourceAgent?.name ?? "agent",
      agentAccountCode: auth.source_account,
      vendor:
        inferVendorFromDescription(auth.description) ||
        vendorFromDest(auth.dest_account),
      amount: auth.amount,
      currency: auth.currency,
      symbol: SYMBOLS[auth.currency] ?? "$",
      status: "pending",
      hash: shortHash(auth.id),
      block: blockCounter,
      ts: now,
      meta: "pending",
    };
    const txs = [tx, ...get().txs].slice(0, 30);

    set({
      agents,
      txs,
      block: blockCounter,
    });
  },

  applyAuthCaptured: (authId, tx) => {
    const now = Date.now();
    blockCounter += 1;

    // The capture transaction has 2 entries: source (out) → dest (in).
    const sourceEntry = tx.entries.find((e) => e.direction === "out");
    if (!sourceEntry) return;
    const captured = sourceEntry.amount;

    const agents = get().agents.map((a) => {
      if (a.accountCode !== sourceEntry.account) return a;
      const newBal = a.balance - captured;
      return {
        ...a,
        balance: newBal,
        on_hold: Math.max(0, a.on_hold - captured),
        history: pushHistory(a.history, newBal),
        tx24h: a.tx24h + 1,
        flash: "down" as FlashState,
        flashUntil: now + FLASH_MS,
        active: true,
      };
    });

    const txs = get().txs.map((row) =>
      row.authId === authId
        ? {
            ...row,
            txId: tx.id,
            status: "captured" as const,
            capturedAmount: captured,
            hash: shortHash(tx.id),
            block: blockCounter,
            ts: now,
            meta: `tokens · ${(2 + Math.random() * 18).toFixed(1)}k`,
          }
        : row,
    );

    const totalUsd = recomputeTotal(agents);
    const prev = get().totalUsd;
    const totalFlash: FlashState =
      totalUsd > prev ? "up" : totalUsd < prev ? "down" : null;
    set({
      agents,
      txs,
      block: blockCounter,
      totalUsd,
      totalFlash,
      totalFlashUntil: now + FLASH_MS,
    });
  },

  applyAuthVoided: (authId) => {
    const voidedTx = get().txs.find((t) => t.authId === authId);
    if (!voidedTx) return;
    const agents = get().agents.map((a) => {
      if (a.accountCode !== voidedTx.agentAccountCode) return a;
      return {
        ...a,
        on_hold: Math.max(0, a.on_hold - voidedTx.amount),
        available: a.available + voidedTx.amount,
      };
    });
    const txs = get().txs.map((row) =>
      row.authId === authId
        ? { ...row, status: "voided" as const, meta: "voided" }
        : row,
    );
    set({ agents, txs });
  },

  setBalance: (accountCode, balance) => {
    const agents = get().agents.map((a) =>
      a.accountCode === accountCode
        ? {
            ...a,
            balance: balance.balance,
            available: balance.available,
            on_hold: balance.on_hold,
          }
        : a,
    );
    set({ agents, totalUsd: recomputeTotal(agents) });
  },

  decayFlashes: () => {
    const now = Date.now();
    const { agents, totalFlash, totalFlashUntil } = get();
    let mutated = false;
    const next = agents.map((a) => {
      if (a.flash && now > a.flashUntil) {
        mutated = true;
        return { ...a, flash: null as FlashState, active: false };
      }
      return a;
    });
    const totalNext = totalFlash && now > totalFlashUntil ? null : totalFlash;
    if (totalNext !== totalFlash) mutated = true;
    if (mutated) set({ agents: next, totalFlash: totalNext });
  },
}));
