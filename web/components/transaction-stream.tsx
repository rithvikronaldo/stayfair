"use client";

import { AnimatePresence, motion } from "motion/react";

import { fmtAge, fmtMinor } from "@/lib/format";
import type { TxRow } from "@/lib/store";
import { DUR, EASE } from "@/lib/motion";

export function TransactionStream({ txs }: { txs: TxRow[] }) {
  const nowMs = Date.now();
  const tps = txs.filter((t) => nowMs - t.ts < 1000).length;

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
        {["All", "Inflow", "Outflow", "Hold", "FX"].map((f, i) => (
          <div
            key={f}
            className={`flex flex-1 items-center justify-center border-r border-border-2 text-[10px] uppercase tracking-[0.14em] last:border-r-0 ${
              i === 0 ? "bg-surface-1 text-fg" : "text-dim"
            }`}
          >
            {f}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {txs.map((tx) => (
            <Row key={tx.id} tx={tx} />
          ))}
        </AnimatePresence>
      </div>

      <div className="num flex h-7 items-center justify-between border-t border-border px-4 text-[10px] tracking-[0.1em] text-dim">
        <span>Showing {txs.length} / 1,247</span>
        <span>Lag · 12 ms</span>
      </div>
    </div>
  );
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
    <motion.div
      layout
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
          <span className="mx-1 text-dim">→</span> vendor:{tx.vendor}
        </div>
        <div className="num mt-0.5 truncate text-[9px] tracking-wide text-dim">
          {tx.hash} · block {tx.block.toLocaleString()}
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
