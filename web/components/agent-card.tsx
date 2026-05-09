"use client";

import { fmtMinor } from "@/lib/format";
import type { AgentRow } from "@/lib/store";

export function AgentCard({ agent }: { agent: AgentRow }) {
  const [whole, frac] = fmtMinor(agent.balance).split(".");

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
      className={`relative border-b border-border px-4 py-3.5 ${
        agent.active
          ? "bg-[linear-gradient(90deg,rgba(245,158,11,0.04),transparent_40%)] before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-accent before:content-['']"
          : ""
      }`}
    >
      <div
        className="absolute right-4 top-4 h-1.5 w-1.5"
        style={{
          background:
            agent.status === "killed"
              ? "var(--dim)"
              : agent.active
                ? "var(--accent)"
                : "var(--green)",
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

      <div className="mb-1.5 text-[13px] text-fg">{agent.name}</div>

      <div className="num flex items-baseline gap-1 text-[22px] leading-none text-fg">
        <span className="text-[14px] text-dim">{agent.symbol}</span>
        <span className={flashCls}>
          {whole}
          <span className="text-muted">.{frac}</span>
        </span>
      </div>

      <Sparkline values={agent.history} active={agent.active} />

      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
        <Cell k="Available" v={fmtMinor(agent.available)} />
        <Cell k="On hold" v={fmtMinor(agent.on_hold)} accent={agent.on_hold > 0} />
        <Cell k="Tx · 24h" v={agent.tx24h.toString()} />
        <Cell k="Burn / hr" v={agent.burnPerHr.toFixed(2)} />
      </div>
    </div>
  );
}

function Cell({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
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
