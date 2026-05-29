"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { fmtAge, fmtMinor } from "@/lib/format";
import { useStore, type TxRow } from "@/lib/store";
import { DUR, EASE } from "@/lib/motion";

type Filter = "all" | "pending" | "captured" | "voided" | "fx";

const FILTERS: { id: Filter; label: string; tip: string }[] = [
  { id: "all", label: "All", tip: "Every transaction in the loaded window, regardless of status or currency." },
  {
    id: "pending",
    label: "Pending",
    tip: "Authorizations that have been created but not yet captured. Available balance is reduced; the balance itself doesn't move until capture.",
  },
  {
    id: "captured",
    label: "Captured",
    tip: "Authorizations that settled — entries are written, balances moved. Captured transactions are immutable from this point.",
  },
  {
    id: "voided",
    label: "Voided",
    tip: "Authorizations that were explicitly cancelled before capture. Reserved funds are released back to available balance; no entries are written.",
  },
  {
    id: "fx",
    label: "FX",
    tip: "Cross-currency transactions where source and destination accounts are in different currencies. Conversion happens at the FX rate stored in the entries at posting time.",
  },
];

function matches(tx: TxRow, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "pending":
      return tx.status === "pending";
    case "captured":
      return tx.status === "captured";
    case "voided":
      return tx.status === "voided";
    case "fx":
      return tx.crossCurrency === true;
  }
}

// Compact integer formatter: 4 → "4", 4521 → "4.5k", 1234567 → "1.2m".
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(1) + "m";
}

export function TransactionStream({ txs }: { txs: TxRow[] }) {
  const nowMs = Date.now();
  const tps = txs.filter((t) => nowMs - t.ts < 1000).length;
  const mode = useStore((s) => s.mode);
  const [filter, setFilter] = useState<Filter>("all");

  // Per-filter counts + the Pending KPI (outstanding amount across all
  // pending rows in the loaded window). Single pass over the array so we
  // don't re-walk it five times.
  const stats = useMemo(() => {
    const counts: Record<Filter, number> = {
      all: txs.length,
      pending: 0,
      captured: 0,
      voided: 0,
      fx: 0,
    };
    let pendingOutstandingMinor = 0;
    for (const t of txs) {
      if (t.status === "pending") {
        counts.pending++;
        pendingOutstandingMinor += t.amount;
      } else if (t.status === "captured") {
        counts.captured++;
      } else if (t.status === "voided") {
        counts.voided++;
      }
      if (t.crossCurrency) counts.fx++;
    }
    return { counts, pendingOutstandingMinor };
  }, [txs]);

  const visible = useMemo(
    () => (filter === "all" ? txs : txs.filter((t) => matches(t, filter))),
    [txs, filter],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-center justify-between border-b border-border px-4">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          Transaction stream
        </span>
        <span className="num text-[10px] tracking-[0.1em] text-dim">
          {tps} / s
        </span>
      </div>

      <div className="flex h-7 border-b border-border">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = stats.counts[f.id];
          const muted = count === 0 && !active;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              title={f.tip}
              className={`flex flex-1 items-center justify-center gap-1.5 border-r border-border-2 text-[10px] uppercase tracking-[0.14em] last:border-r-0 transition-colors ${
                active
                  ? "bg-surface-1 text-fg"
                  : muted
                    ? "text-dim/50 hover:text-dim"
                    : "text-dim hover:bg-surface-2/40 hover:text-muted"
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`num tracking-[0.05em] ${
                  active ? "text-accent" : ""
                }`}
              >
                {fmtCount(count)}
              </span>
            </button>
          );
        })}
      </div>

      {stats.counts.pending > 0 && (
        <div className="num flex h-6 items-center justify-between border-b border-border-2 bg-surface-2/30 px-4 text-[10px] tracking-[0.12em]">
          <span className="text-dim">
            {stats.counts.pending} hold{stats.counts.pending === 1 ? "" : "s"}{" "}
            outstanding
          </span>
          <span className="text-accent">
            ${fmtMinor(stats.pendingOutstandingMinor)}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 && mode === "self" ? (
          <div className="px-4 py-6 text-[11px] leading-relaxed text-muted">
            <div className="num mb-2 text-[10px] uppercase tracking-[0.12em] text-accent">
              {filter === "all" ? "your stream — empty" : `no ${filter} txs`}
            </div>
            {filter === "all" ? (
              <>
                Post a transfer — use <span className="text-fg">＋ New</span> in
                the top bar or{" "}
                <span className="text-fg">Fund this account</span> on any empty
                account — and it&apos;ll appear here within a few seconds.
              </>
            ) : (
              <>
                Nothing matched the <span className="text-fg">{filter}</span>{" "}
                filter in the loaded window.
              </>
            )}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((tx) => (
              <Row key={tx.id} tx={tx} />
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className="num flex h-7 items-center justify-between border-t border-border px-4 text-[10px] tracking-[0.1em] text-dim">
        <span>
          {visible.length === 0
            ? "—"
            : filter === "all"
              ? `Showing ${visible.length}`
              : `Showing ${visible.length} / ${txs.length}`}
        </span>
        <span>
          {visible.length > 0 ? `last · ${fmtAge(nowMs - visible[0].ts)}` : ""}
        </span>
      </div>
    </div>
  );
}

// copyTxId copies the full tx UUID (not the truncated hash) to the
// clipboard and fires a sonner toast. Falls back gracefully when the
// clipboard API is unavailable (older browsers / non-secure contexts).
async function copyTxId(tx: TxRow) {
  const id = tx.txId ?? tx.authId ?? tx.id;
  try {
    await navigator.clipboard.writeText(id);
    toast.success("tx id copied", { description: id });
  } catch {
    toast.error("copy failed — clipboard unavailable");
  }
}

function Row({ tx }: { tx: TxRow }) {
  const isPending = tx.status === "pending";
  const isVoided = tx.status === "voided";

  const dirLabel = isPending
    ? "PENDING · AUTH"
    : isVoided
      ? "VOIDED"
      : "OUT · CAPTURED";

  const pipBg = isPending
    ? "var(--accent)"
    : isVoided
      ? "var(--dim)"
      : "var(--red)";

  const amountAmount = fmtMinor(
    isPending ? tx.amount : (tx.capturedAmount ?? tx.amount),
  );

  const amountColor = isPending
    ? "var(--accent)"
    : isVoided
      ? "var(--dim)"
      : "var(--fg)";

  return (
    // No `layout` prop: it ran a FLIP position-animation on every row whenever
    // the list changed, which thrashed hard when many rows arrived at once
    // (stress). New rows still slide/fade in; existing rows just reposition.
    <motion.div
      initial={{ opacity: 0, x: 18 }}
      animate={{
        opacity: isVoided ? 0.55 : 1,
        x: 0,
        backgroundColor: isPending
          ? "rgba(245,158,11,0.08)"
          : "rgba(0,0,0,0)",
      }}
      exit={{ opacity: 0 }}
      transition={{
        duration: DUR.entrance,
        ease: EASE.outQuart,
        backgroundColor: { duration: 0.4, ease: EASE.outQuart },
      }}
      className="relative grid grid-cols-[8px_1fr_auto] gap-2.5 border-b border-border-2 px-3.5 py-3"
    >
      <span
        className="mt-1.5 h-1 w-1"
        style={{ background: pipBg }}
      />

      <div className="min-w-0">
        <div className="num flex items-baseline gap-1.5 text-[14px]">
          <span style={{ color: amountColor }}>
            {tx.symbol}
            {amountAmount}
          </span>
          <span className="truncate text-[10px] tracking-[0.12em] text-dim">
            {tx.currency} · {dirLabel}
          </span>
        </div>
        <div className="num mt-1 truncate text-[11px] tracking-wide text-muted">
          {tx.agentCode} · {tx.agentName}{" "}
          <span className="mx-1 text-dim">→</span> {tx.vendor}
        </div>
        <div className="num mt-0.5 truncate text-[9px] tracking-wide text-dim">
          <button
            type="button"
            onClick={() => copyTxId(tx)}
            className="cursor-pointer hover:text-muted"
            title="Copy full transaction ID"
          >
            {tx.hash}
          </button>
        </div>
      </div>

      <div className="text-right">
        <div
          className="num text-[10px] tracking-wide"
          style={{ color: isPending ? "var(--accent)" : "var(--dim)" }}
        >
          {fmtAge(Date.now() - tx.ts)}
        </div>
        {tx.meta && (
          <div className="num mt-1 text-[9px] text-dim">{tx.meta}</div>
        )}
      </div>
    </motion.div>
  );
}
