"use client";

import { AnimatePresence, motion } from "motion/react";

import { fmtAge, fmtMinor, type SimTx } from "@/lib/sim";
import { DUR, EASE } from "@/lib/motion";

export function TransactionStream({ txs }: { txs: SimTx[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-center justify-between border-b border-border px-4">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          Transaction stream
        </span>
        <span className="num text-[10px] tracking-[0.1em] text-dim">
          {txs.length > 0
            ? `${(txs.filter((t) => Date.now() - t.ts < 1000).length).toString()} / s`
            : "0 / s"}
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
          {txs.map((tx, i) => (
            <Row key={tx.id} tx={tx} entering={i < 2} />
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

function Row({ tx, entering }: { tx: SimTx; entering: boolean }) {
  const isSplit = tx.direction === "split";
  const pipColor =
    tx.direction === "in"
      ? "var(--green)"
      : tx.direction === "out"
        ? "var(--red)"
        : tx.direction === "hold"
          ? "var(--accent)"
          : undefined;
  const arrow = tx.direction === "in" ? "→" : tx.direction === "out" ? "→" : "→";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DUR.entrance, ease: EASE.outQuart }}
      className={`relative grid grid-cols-[8px_1fr_auto] gap-2.5 border-b border-border-2 px-3.5 py-3 ${
        isSplit
          ? "bg-[linear-gradient(180deg,rgba(245,158,11,0.10)_0%_49%,rgba(16,185,129,0.10)_51%_100%)] before:absolute before:left-0 before:right-0 before:top-1/2 before:h-px before:bg-white/[0.06] before:content-['']"
          : ""
      } ${entering ? "[mask:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,#000_60%)]" : ""}`}
    >
      <span
        className="mt-1.5 h-1 w-1"
        style={{
          background: isSplit
            ? "linear-gradient(180deg,var(--accent) 0% 49%, var(--green) 51% 100%)"
            : pipColor,
        }}
      />

      <div className="min-w-0">
        <div className="num flex items-baseline gap-1.5 text-[14px]">
          <span style={{ color: isSplit ? "var(--accent)" : "var(--fg)" }}>
            {tx.symbol}
            {fmtMinor(tx.amount)}
          </span>
          <span className="truncate text-[10px] tracking-[0.12em] text-dim">
            {tx.currency} ·{" "}
            {isSplit
              ? "AUTH → CAPTURE"
              : tx.direction === "in"
                ? "IN"
                : tx.direction === "out"
                  ? "OUT"
                  : "HOLD"}
          </span>
        </div>
        <div className="num mt-1 truncate text-[11px] tracking-wide text-muted">
          {tx.direction === "in"
            ? `vendor:${tx.vendor}`
            : `${tx.agentCode} · ${tx.agentName}`}{" "}
          <span className="mx-1 text-dim">{arrow}</span>{" "}
          {tx.direction === "in"
            ? `${tx.agentCode} · ${tx.agentName}`
            : `vendor:${tx.vendor}`}
        </div>
        <div className="num mt-0.5 truncate text-[9px] tracking-wide text-dim">
          {tx.hash} · block {tx.block.toLocaleString()}
        </div>
      </div>

      <div className="text-right">
        <div
          className="num text-[10px] tracking-wide"
          style={{ color: isSplit ? "var(--accent)" : "var(--dim)" }}
        >
          {fmtAge(tx.ageMs)}
        </div>
        {tx.meta && (
          <div className="num mt-1 text-[9px] text-dim">{tx.meta}</div>
        )}
      </div>
    </motion.div>
  );
}
