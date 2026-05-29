"use client";

import { useActionDialog } from "@/lib/action-dialog";
import { useAnimatedNumber } from "@/lib/animated-number";
import { fmtMinor } from "@/lib/format";
import type { AgentRow } from "@/lib/store";

export function AgentCard({ agent }: { agent: AgentRow }) {
  const openDialog = useActionDialog((s) => s.openDialog);
  const animatedBalance = useAnimatedNumber(agent.balance);
  const animatedAvailable = useAnimatedNumber(agent.available);
  const animatedOnHold = useAnimatedNumber(agent.on_hold);
  const [whole, frac] = fmtMinor(animatedBalance).split(".");

  // An empty, untouched jar: $0 with nothing pending. Show a one-click fund
  // nudge so a freshly-opened account isn't a dead end.
  const needsFunding =
    agent.status !== "killed" && agent.balance === 0 && agent.on_hold === 0;

  const flashCls =
    agent.flash === "up"
      ? "flash-up"
      : agent.flash === "down"
        ? "flash-down"
        : agent.flash === "hold"
          ? "flash-hold"
          : "";

  return (
    <div
      className={`relative border-b border-border px-3 py-2.5 ${
        agent.active
          ? "bg-[linear-gradient(90deg,rgba(245,158,11,0.04),transparent_40%)] before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-accent before:content-['']"
          : ""
      }`}
    >
      {/* Per-event row pulse (W5 D6). Keyed by flashUntil so each new flash
          remounts and re-plays the 600ms yellow → transparent animation.
          Pointer-events disabled so it never blocks card interaction. */}
      {agent.flashUntil > 0 && (
        <div
          key={agent.flashUntil}
          className="row-pulse absolute inset-0 pointer-events-none"
        />
      )}

      {/* Fundedness pip. Green = positive position (funded), amber = net
          paid-out (e.g., treasury accounts that funded others into negative
          territory — informational, not alarm), dim = empty or killed. The
          per-event flash that used to flicker this amber was redundant with
          the row pulse, so this is purely a position-state indicator now. */}
      <div
        className="absolute right-4 top-4 h-1.5 w-1.5"
        title={fundednessTitle(agent.status, agent.balance)}
        style={{
          background:
            agent.status === "killed"
              ? "var(--dim)"
              : agent.balance > 0
                ? "var(--green)"
                : agent.balance < 0
                  ? "var(--accent)"
                  : "var(--dim)",
        }}
      />

      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="num text-[11px] tracking-[0.1em] text-muted">
          {agent.code}
        </span>
        <span className="text-[10px] tracking-[0.14em] text-dim">
          {agent.currency}
        </span>
      </div>

      <div className="mb-1 text-[12px] text-fg">{agent.name}</div>

      <div className="num flex items-baseline gap-1 text-[18px] leading-none text-fg">
        <span className="text-[12px] text-dim">{agent.symbol}</span>
        <span className={flashCls}>
          {whole}
          <span className="text-muted">.{frac}</span>
        </span>
      </div>

      <Sparkline values={agent.history} active={agent.active} />

      <div className="mt-2 grid grid-cols-2 gap-x-2.5 gap-y-1">
        <Cell
          k="Available"
          v={fmtMinor(animatedAvailable)}
          tip="Balance minus pending authorizations. The amount this account can authorize right now without overdrawing into its holds."
        />
        <Cell
          k="On hold"
          v={fmtMinor(animatedOnHold)}
          accent={agent.on_hold > 0}
          tip="Sum of pending authorizations against this account — money auth'd-out but not yet captured. Like a card-swipe hold at a gas pump."
        />
        <Cell
          k="Tx · 24h"
          v={agent.tx24h.toString()}
          tip="Number of transactions touching this account in the last 24 hours. Computed from the loaded tx window (up to 1,000 events)."
        />
        <Cell
          k="Burn / hr"
          v={agent.burnPerHr.toFixed(2)}
          tip="Net outflow rate from this account over the last hour, in major units per hour. How fast money is leaving."
        />
      </div>

      {needsFunding && (
        <div className="mt-3 border-t border-border-2 pt-2.5">
          <p className="mb-2 text-[11px] leading-snug text-dim">
            No funds yet — post a transfer in to bring this account to life.
          </p>
          <button
            type="button"
            onClick={() => openDialog("post", { dest: agent.accountCode })}
            className="num flex h-7 w-full items-center justify-center border border-accent/40 bg-accent/10 text-[10px] uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent/20"
          >
            ▶ Fund this account
          </button>
        </div>
      )}
    </div>
  );
}

function Cell({
  k,
  v,
  accent,
  tip,
}: {
  k: string;
  v: string;
  accent?: boolean;
  tip?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5" title={tip}>
      <span className="text-[10px] uppercase tracking-[0.1em] text-dim">
        {k}
      </span>
      <span
        className={`num text-[12px] ${accent ? "text-accent" : "text-muted"}`}
      >
        {v}
      </span>
    </div>
  );
}

function fundednessTitle(status: string, balance: number): string {
  if (status === "killed") return "Account killed";
  if (balance > 0) return "Positive position · funded";
  if (balance < 0) return "Negative position · net paid-out (funded others)";
  return "Empty · zero balance";
}

function Sparkline({
  values,
  active,
}: {
  values: number[];
  active: boolean;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 240;
  const h = 18;
  const dx = w / (values.length - 1);
  const path = values
    .map((v, i) => {
      const x = i * dx;
      const y = h - 2 - ((v - min) / range) * (h - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="mt-2.5 block h-[18px] w-full opacity-70"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke={active ? "var(--accent-dim)" : "var(--dim)"}
        strokeWidth="1"
      />
    </svg>
  );
}
