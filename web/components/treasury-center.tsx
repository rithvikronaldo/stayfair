"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useTransform, motion } from "motion/react";

import { fmtMinor, type FlashState, type SimAgent } from "@/lib/sim";
import { DUR, EASE } from "@/lib/motion";

export function TreasuryCenter({
  totalUsd,
  flash,
  agents,
}: {
  totalUsd: number;
  flash: FlashState;
  agents: SimAgent[];
}) {
  const tx24h = agents.reduce((acc, a) => acc + a.tx24h, 0);
  const burnPerHr = agents.reduce(
    (acc, a) => acc + a.burnPerHr,
    0,
  );

  return (
    <div className="relative flex h-full flex-col px-8 pt-6">
      <div className="flex h-6 items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.12em] text-fg">
          Treasury
        </span>
        <span className="text-[11px] text-dim">·</span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          USD
        </span>
        <span className="text-[11px] text-dim">·</span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          All agents
        </span>
        <span className="text-[11px] text-dim">·</span>
        <span className="num text-[11px] uppercase tracking-[0.12em] text-muted">
          As of <LiveTimestamp />
        </span>
        <div className="flex-1" />
        <span className="num text-[11px] uppercase tracking-[0.12em] text-muted">
          Reconcile <span className="text-green">OK</span>
        </span>
      </div>

      <div className="mt-8 grid grid-cols-[auto_1fr_auto] items-end gap-8">
        <HeroNumber totalUsd={totalUsd} flash={flash} />

        <SideStats
          rows={[
            { k: "Open", v: "186.62" },
            { k: "High · 24h", v: "247.89" },
            { k: "Low · 24h", v: "114.20" },
            { k: "Volume", v: `${tx24h.toLocaleString()} tx` },
            { k: "Burn rate", v: `$${burnPerHr.toFixed(2)} / hr` },
            { k: "Runway", v: estRunway(totalUsd, burnPerHr) },
          ]}
        />

        <div className="flex flex-col items-end gap-1.5 pb-3">
          <Delta value="+0.83" tone="up" sub="last tick" />
          <SideRow k="Last hour" v="−1.65" tone="red" />
          <SideRow k="vs Open" v="+12.04" tone="green" />
          <SideRow k="band · 24h" v="3.4σ" />
          <SideRow k="tick latency" v="214 ms" />
        </div>
      </div>

      <ChartPlaceholder />
    </div>
  );
}

function HeroNumber({
  totalUsd,
  flash,
}: {
  totalUsd: number;
  flash: FlashState;
}) {
  const mv = useMotionValue(totalUsd);
  const display = useTransform(mv, (v) => fmtMinor(v));
  const prev = useRef(totalUsd);

  useEffect(() => {
    const controls = animate(mv, totalUsd, {
      duration: DUR.entrance,
      ease: EASE.outQuart,
    });
    prev.current = totalUsd;
    return () => controls.stop();
  }, [totalUsd, mv]);

  const flashCls =
    flash === "up"
      ? "flash-up"
      : flash === "down"
        ? "flash-down"
        : flash === "hold"
          ? "flash-hold"
          : "";

  const [whole, frac] = fmtMinor(totalUsd).split(".");
  void whole;
  void frac;

  return (
    <div className="num flex items-baseline gap-3 leading-none tracking-tight text-fg">
      <span className="text-[clamp(40px,5vw,64px)] font-light text-dim">$</span>
      <motion.span
        className={`text-[clamp(72px,9vw,128px)] font-light ${flashCls}`}
      >
        <motion.span>{display}</motion.span>
      </motion.span>
    </div>
  );
}

function SideStats({ rows }: { rows: { k: string; v: string }[] }) {
  return (
    <div className="flex flex-col gap-1.5 pb-3">
      {rows.map((r) => (
        <div key={r.k} className="flex items-baseline gap-2.5 text-[12px]">
          <span className="w-24 text-[10px] uppercase tracking-[0.12em] text-muted">
            {r.k}
          </span>
          <span className="num text-fg">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

function SideRow({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "green" | "red";
}) {
  const colorCls = tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-fg";
  return (
    <div className="flex items-baseline justify-end gap-2.5 text-[12px]">
      <span className={`num ${colorCls}`}>{v}</span>
      <span className="w-20 text-right text-[10px] uppercase tracking-[0.12em] text-muted">
        {k}
      </span>
    </div>
  );
}

function Delta({
  value,
  tone,
  sub,
}: {
  value: string;
  tone: "up" | "down";
  sub: string;
}) {
  return (
    <div
      className={`num text-[14px] ${tone === "up" ? "text-green" : "text-red"}`}
    >
      ↑ {value}{" "}
      <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-muted">
        {sub}
      </span>
    </div>
  );
}

function LiveTimestamp() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const yyyy = now.getUTCFullYear();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  return (
    <span className="text-accent">
      LIVE · {yyyy}-{mm}-{dd} {hh}:{mi}:{ss} UTC
    </span>
  );
}

function estRunway(totalUsd: number, burnPerHr: number): string {
  const hrs = totalUsd / 100 / Math.max(burnPerHr, 0.01);
  const h = Math.floor(hrs);
  const m = Math.floor((hrs - h) * 60);
  return `${h}h ${m}m`;
}

function ChartPlaceholder() {
  return (
    <div className="mt-8 flex flex-1 flex-col border-t border-border-2 pt-4">
      <div className="flex h-5 items-center justify-between">
        <div className="flex">
          {["24H", "7D", "30D", "ALL"].map((t, i) => (
            <span
              key={t}
              className={`border-l border-border px-3 py-1 text-[11px] uppercase tracking-[0.1em] last:border-r ${
                i === 0 ? "bg-surface-1 text-fg" : "text-dim"
              }`}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex gap-4">
          <span className="num text-[11px] uppercase tracking-[0.1em] text-muted">
            USD · 1m candles · 1,440 pts
          </span>
          <span className="text-[11px] uppercase tracking-[0.1em] text-muted">
            <span className="text-accent">●</span> price
          </span>
        </div>
      </div>
      <div className="mt-2 flex-1 border-b border-border-2" />
      <div className="num flex justify-between border-t border-border-2 py-1.5 text-[10px] tracking-[0.1em] text-dim">
        <span>−24h 00m</span>
        <span>−18h</span>
        <span>−12h</span>
        <span>−06h</span>
        <span>NOW</span>
      </div>
    </div>
  );
}
