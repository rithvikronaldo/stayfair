"use client";

import { create } from "zustand";

import type {
  Agent,
  AgentSummary,
  Authorization,
  Balance,
  PostedTransaction,
  StressResult,
} from "@/lib/api";

export type TimeSkipPhase =
  | "idle"
  | "rewinding"
  | "buffering"
  | "playing"
  | "paused"
  | "done";

export type TimeSkipSpeed = 1 | 10 | 100 | 1000;

export type StressPhase = "idle" | "running" | "done";

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
  // Scrubber state. null = "NOW" (live). A Date = "viewing past state".
  // When non-null, the dashboard pauses live updates and re-fetches
  // balances at the selected timestamp, animating values to historical
  // values. UI shows REPLAY indicator instead of LIVE.
  asOf: Date | null;

  // Time Skip orchestrator state (W5 D5). idle = scrubber-controlled. The
  // other phases are owned by useTimeSkip(), which drives playback once
  // ▶ Replay is clicked. timeSkipCursor advances as the queue plays.
  timeSkipPhase: TimeSkipPhase;
  timeSkipSpeed: TimeSkipSpeed;
  timeSkipCursor: number;
  timeSkipTotal: number;

  // Stress / Take-Off state (W5 D7; reworked W6 D2 to real batched progress).
  stressPhase: StressPhase;
  stressN: number;          // requested N for the in-flight run
  stressStartedAt: number;  // wall-clock ms (Date.now()) when the run kicked off
  stressResult: StressResult | null;
  stressPosted: number;     // REAL cumulative committed count (advances per batch)
  stressSamples: { t: number; posted: number }[]; // real chart points: t=sec, posted
};

type Actions = {
  setBootstrapped: (b: boolean) => void;
  setConnected: (b: boolean) => void;
  setMode: (m: ViewMode) => void;
  setAsOf: (d: Date | null) => void;
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

  // Time Skip (W5 D5).
  setTimeSkipPhase: (p: TimeSkipPhase) => void;
  setTimeSkipSpeed: (s: TimeSkipSpeed) => void;
  setTimeSkipCursor: (cursor: number, total: number) => void;
  applyReplayEvent: (tx: PostedTransaction) => void;
  applyPostedTransaction: (tx: PostedTransaction) => void;
  // hydrateTxStream backfills the feed with recent history on sign-in. Unlike
  // applyPostedTransaction it does NOT touch balances — those are already
  // correct from the seed, so re-applying deltas would double-count.
  hydrateTxStream: (transactions: PostedTransaction[]) => void;
  // pushStressRows prepends a few just-committed rows during a stress run
  // (smooth trickle, no full-list replace). See implementation for why.
  pushStressRows: (transactions: PostedTransaction[]) => void;
  clearReplayState: () => void;

  // Stress / Take-Off (W5 D7).
  startStress: (n: number) => void;
  // advanceStress records REAL progress after each committed batch: the
  // cumulative posted count + a chart sample at tSec seconds since start.
  advanceStress: (posted: number, tSec: number) => void;
  completeStress: (result: StressResult) => void;
  resetStress: () => void;
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
  if (!dest) return "pool";
  const m = dest.match(/^vendor_pool_/i);
  if (m) return "vendor:pool";
  if (dest.startsWith("agent_")) return dest.slice(0, 14);
  return dest;
}

function inferVendorFromDescription(desc: string): string {
  if (!desc) return "pool";
  const m = desc.match(/(?:cp|vendor):(\w+)/i);
  return m ? m[1] : "pool";
}

// buildHistoryRow maps a settled PostedTransaction into a feed row WITHOUT
// touching balances. Shared by hydrateTxStream (sign-in backfill) and
// pushStressRows (the trickle during a stress run). Returns null for a
// malformed tx (missing an in/out leg).
function buildHistoryRow(
  tx: PostedTransaction,
  byCode: Map<string, AgentRow>,
  block: number,
): TxRow | null {
  const sourceEntry = tx.entries.find((e) => e.direction === "out");
  const destEntry = tx.entries.find((e) => e.direction === "in");
  if (!sourceEntry || !destEntry) return null;
  const sourceAgent = byCode.get(sourceEntry.account);
  return {
    id: `tx-hist-${tx.id}`,
    txId: tx.id,
    agentCode: sourceAgent?.code ?? "?",
    agentName: sourceAgent?.name ?? "account",
    agentAccountCode: sourceEntry.account,
    vendor:
      inferVendorFromDescription(tx.description) ||
      vendorFromDest(destEntry.account),
    amount: sourceEntry.amount,
    capturedAmount: sourceEntry.amount,
    currency: sourceEntry.currency,
    symbol: SYMBOLS[sourceEntry.currency] ?? "$",
    status: "captured",
    hash: shortHash(tx.id),
    block,
    ts: Date.parse(tx.occurred_at) || Date.now(),
  };
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
  asOf: null,
  timeSkipPhase: "idle",
  timeSkipSpeed: 10,
  timeSkipCursor: 0,
  timeSkipTotal: 0,
  stressPhase: "idle",
  stressN: 0,
  stressStartedAt: 0,
  stressResult: null,
  stressPosted: 0,
  stressSamples: [],

  setBootstrapped: (b) => set({ bootstrapped: b }),
  setConnected: (b) => set({ connected: b }),
  setMode: (m) => set({ mode: m }),
  setAsOf: (d) => set({ asOf: d }),
  reset: () =>
    set({
      agents: [],
      txs: [],
      totalUsd: 0,
      totalFlash: null,
      totalFlashUntil: 0,
      bootstrapped: false,
      asOf: null,
      timeSkipPhase: "idle",
      timeSkipCursor: 0,
      timeSkipTotal: 0,
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

    // The capture transaction has 2 entries: source (out) → dest (in). Animate
    // BOTH sides so The Catch reads as money moving — source ticks down and
    // releases the hold, dest ticks up. Earlier this only moved the source,
    // leaving the receiving card stale until the next poll.
    const sourceEntry = tx.entries.find((e) => e.direction === "out");
    if (!sourceEntry) return;
    const captured = sourceEntry.amount;
    const entriesByAccount = new Map(tx.entries.map((e) => [e.account, e]));

    const agents = get().agents.map((a) => {
      const entry = entriesByAccount.get(a.accountCode);
      if (!entry) return a;
      const delta = entry.direction === "in" ? entry.amount : -entry.amount;
      const newBal = a.balance + delta;
      return {
        ...a,
        balance: newBal,
        // Only the source account released a hold for this capture.
        on_hold:
          entry.direction === "out"
            ? Math.max(0, a.on_hold - captured)
            : a.on_hold,
        available:
          entry.direction === "in" ? a.available + entry.amount : a.available,
        history: pushHistory(a.history, newBal),
        tx24h: a.tx24h + 1,
        flash: (delta >= 0 ? "up" : "down") as FlashState,
        flashUntil: now + FLASH_MS,
        active: true,
      };
    });

    // Flip the matching pending row to captured. In demo mode that row exists
    // (applyAuthCreated streamed it). In self mode the seeded auth was never
    // streamed — polling only hydrates balances — so synthesize a captured row
    // from the tx itself, otherwise The Catch would move balances but leave the
    // transaction stream empty.
    let matched = false;
    const mappedTxs = get().txs.map((row) => {
      if (row.authId !== authId) return row;
      matched = true;
      return {
        ...row,
        txId: tx.id,
        status: "captured" as const,
        capturedAmount: captured,
        hash: shortHash(tx.id),
        block: blockCounter,
        ts: now,
        meta: `tokens · ${(2 + Math.random() * 18).toFixed(1)}k`,
      };
    });
    let txs = mappedTxs;
    if (!matched) {
      const destEntry = tx.entries.find((e) => e.direction === "in");
      const sourceAgent = get().agents.find(
        (a) => a.accountCode === sourceEntry.account,
      );
      const row: TxRow = {
        id: `tx-${authId}`,
        authId,
        txId: tx.id,
        agentCode: sourceAgent?.code ?? "?",
        agentName: sourceAgent?.name ?? "agent",
        agentAccountCode: sourceEntry.account,
        vendor:
          inferVendorFromDescription(tx.description) ||
          (destEntry ? vendorFromDest(destEntry.account) : "pool"),
        amount: captured,
        capturedAmount: captured,
        currency: sourceEntry.currency,
        symbol: SYMBOLS[sourceEntry.currency] ?? "$",
        status: "captured",
        hash: shortHash(tx.id),
        block: blockCounter,
        ts: now,
        meta: `tokens · ${(2 + Math.random() * 18).toFixed(1)}k`,
      };
      txs = [row, ...mappedTxs].slice(0, 30);
    }

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

  setTimeSkipPhase: (p) => set({ timeSkipPhase: p }),
  setTimeSkipSpeed: (s) => set({ timeSkipSpeed: s }),
  setTimeSkipCursor: (cursor, total) =>
    set({ timeSkipCursor: cursor, timeSkipTotal: total }),

  // applyReplayEvent walks a historical PostedTransaction's entries and
  // applies them as forward-direction balance deltas on the dashboard.
  // Same shape as applyAuthCaptured but driven by a posted tx rather than
  // an auth → capture pair, since the queue stores raw transactions.
  applyReplayEvent: (tx) => {
    const now = Date.now();
    blockCounter += 1;

    const entriesByAccount = new Map<string, PostedTransaction["entries"][number]>();
    for (const e of tx.entries) entriesByAccount.set(e.account, e);

    const agents = get().agents.map((a) => {
      const entry = entriesByAccount.get(a.accountCode);
      if (!entry) return a;
      const delta = entry.direction === "in" ? entry.amount : -entry.amount;
      const newBal = a.balance + delta;
      return {
        ...a,
        balance: newBal,
        available: a.available + delta,
        history: pushHistory(a.history, newBal),
        tx24h: a.tx24h + 1,
        flash: (delta >= 0 ? "up" : "down") as FlashState,
        flashUntil: now + FLASH_MS,
        active: true,
      };
    });

    const sourceEntry = tx.entries.find((e) => e.direction === "out");
    const destEntry = tx.entries.find((e) => e.direction === "in");
    let txs = get().txs;
    if (sourceEntry && destEntry) {
      const sourceAgent = get().agents.find(
        (a) => a.accountCode === sourceEntry.account,
      );
      const row: TxRow = {
        id: `tx-replay-${tx.id}`,
        txId: tx.id,
        agentCode: sourceAgent?.code ?? "?",
        agentName: sourceAgent?.name ?? "agent",
        agentAccountCode: sourceEntry.account,
        vendor:
          inferVendorFromDescription(tx.description) ||
          vendorFromDest(destEntry.account),
        amount: sourceEntry.amount,
        capturedAmount: sourceEntry.amount,
        currency: sourceEntry.currency,
        symbol: SYMBOLS[sourceEntry.currency] ?? "$",
        status: "captured",
        hash: shortHash(tx.id),
        block: blockCounter,
        ts: new Date(tx.occurred_at).getTime(),
        meta: "replay",
      };
      txs = [row, ...txs].slice(0, 30);
    }

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

  // applyPostedTransaction reflects a just-posted transaction immediately, the
  // same way replay applies a historical one, but tagged as live (meta:"post")
  // so clearReplayState never wipes it and the row reads as real activity. Used
  // by the in-app "post transaction" form so the dashboard moves on submit
  // rather than waiting for the 5s self-mode poll.
  applyPostedTransaction: (tx) => {
    const now = Date.now();
    blockCounter += 1;

    const entriesByAccount = new Map<string, PostedTransaction["entries"][number]>();
    for (const e of tx.entries) entriesByAccount.set(e.account, e);

    const agents = get().agents.map((a) => {
      const entry = entriesByAccount.get(a.accountCode);
      if (!entry) return a;
      const delta = entry.direction === "in" ? entry.amount : -entry.amount;
      const newBal = a.balance + delta;
      return {
        ...a,
        balance: newBal,
        available: a.available + delta,
        history: pushHistory(a.history, newBal),
        tx24h: a.tx24h + 1,
        flash: (delta >= 0 ? "up" : "down") as FlashState,
        flashUntil: now + FLASH_MS,
        active: true,
      };
    });

    const sourceEntry = tx.entries.find((e) => e.direction === "out");
    const destEntry = tx.entries.find((e) => e.direction === "in");
    let txs = get().txs;
    if (sourceEntry && destEntry) {
      const sourceAgent = get().agents.find(
        (a) => a.accountCode === sourceEntry.account,
      );
      const row: TxRow = {
        id: `tx-post-${tx.id}`,
        txId: tx.id,
        agentCode: sourceAgent?.code ?? "?",
        agentName: sourceAgent?.name ?? "agent",
        agentAccountCode: sourceEntry.account,
        vendor:
          inferVendorFromDescription(tx.description) ||
          vendorFromDest(destEntry.account),
        amount: sourceEntry.amount,
        capturedAmount: sourceEntry.amount,
        currency: sourceEntry.currency,
        symbol: SYMBOLS[sourceEntry.currency] ?? "$",
        status: "captured",
        hash: shortHash(tx.id),
        block: blockCounter,
        ts: now,
        meta: "post",
      };
      txs = [row, ...txs].slice(0, 30);
    }

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

  hydrateTxStream: (transactions) => {
    const byCode = new Map(get().agents.map((a) => [a.accountCode, a]));
    const historyRows = transactions
      .map((tx, i) => buildHistoryRow(tx, byCode, blockCounter - i - 1))
      .filter((r): r is TxRow => r !== null);

    // Merge with any live rows already present (e.g. First Tick fired before
    // backfill landed), dedupe by txId so a transaction is never listed twice,
    // then show newest-first and cap to the stream window.
    const seen = new Set(historyRows.map((r) => r.txId));
    const merged = [
      ...get().txs.filter((r) => !r.txId || !seen.has(r.txId)),
      ...historyRows,
    ].sort((a, b) => b.ts - a.ts);
    set({ txs: merged.slice(0, 30) });
  },

  // pushStressRows trickles a few freshly-committed rows onto the TOP of the
  // feed during a stress run. Unlike hydrateTxStream it does NOT re-sort or
  // replace the whole list — it prepends only rows not already shown — so the
  // feed grows a few rows at a time (smooth, like the live stream) instead of
  // swapping all 30 every batch (which thrashed Framer layout and stuttered).
  pushStressRows: (transactions) => {
    const byCode = new Map(get().agents.map((a) => [a.accountCode, a]));
    const existing = get().txs;
    const shown = new Set(existing.map((r) => r.txId).filter(Boolean));
    const fresh: TxRow[] = [];
    transactions.forEach((tx, i) => {
      if (shown.has(tx.id)) return;
      const row = buildHistoryRow(tx, byCode, blockCounter + i + 1);
      if (row) fresh.push(row);
    });
    if (fresh.length === 0) return;
    fresh.sort((a, b) => b.ts - a.ts);
    set({ txs: [...fresh, ...existing].slice(0, 30) });
  },

  // clearReplayState wipes any replay-tagged txs and resets orchestrator
  // state. Called on snap-to-NOW / new replay run.
  clearReplayState: () => {
    set({
      txs: get().txs.filter((t) => t.meta !== "replay"),
      timeSkipPhase: "idle",
      timeSkipCursor: 0,
      timeSkipTotal: 0,
    });
  },

  startStress: (n) => {
    set({
      stressPhase: "running",
      stressN: n,
      stressStartedAt: Date.now(),
      stressResult: null,
      stressPosted: 0,
      stressSamples: [{ t: 0, posted: 0 }],
    });
  },
  advanceStress: (posted, tSec) => {
    set({
      stressPosted: posted,
      stressSamples: [...get().stressSamples, { t: tSec, posted }],
    });
  },
  completeStress: (result) => {
    set({
      stressPhase: "done",
      stressResult: result,
      stressPosted: result.n_posted,
      stressSamples: [
        ...get().stressSamples,
        { t: result.elapsed_ms / 1000, posted: result.n_posted },
      ],
    });
  },
  resetStress: () => {
    set({
      stressPhase: "idle",
      stressN: 0,
      stressStartedAt: 0,
      stressResult: null,
      stressPosted: 0,
      stressSamples: [],
    });
  },
}));
