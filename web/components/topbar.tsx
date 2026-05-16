"use client";

import { useEffect, useState } from "react";

import { SoundToggle } from "@/components/sound-toggle";

export function TopBar({
  agentCount,
  ccyCount,
  txCount,
  block,
}: {
  agentCount: number;
  ccyCount: number;
  txCount: number;
  block: number;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 200);
    return () => clearInterval(id);
  }, []);

  const hh = now?.getUTCHours().toString().padStart(2, "0") ?? "--";
  const mm = now?.getUTCMinutes().toString().padStart(2, "0") ?? "--";
  const ss = now?.getUTCSeconds().toString().padStart(2, "0") ?? "--";
  const ms = now?.getUTCMilliseconds().toString().padStart(3, "0") ?? "---";

  return (
    <header className="relative flex h-10 items-center border-b border-border bg-bg">
      <Group>
        <div className="h-2 w-2 bg-accent" />
        <span className="text-[11px] font-semibold tracking-[0.18em] text-fg">
          ACTA
        </span>
        <span className="text-[11px] uppercase tracking-[0.1em] text-muted">
          Ledger
        </span>
      </Group>

      <Group>
        <span className="num text-[11px] uppercase tracking-[0.1em] text-dim">
          LEDGER · BLOCK {block.toLocaleString()}
        </span>
      </Group>

      <Group>
        <span className="num text-[11px] uppercase tracking-[0.1em] text-dim">
          DOUBLE-ENTRY · USD BASE
        </span>
      </Group>

      <Group>
        <span className="num text-[11px] uppercase tracking-[0.1em] text-dim">
          {agentCount} ACCOUNTS · {ccyCount} CCY · {txCount.toLocaleString()} TX
        </span>
      </Group>

      <div className="flex-1" />

      <Group>
        <Pill tone="dim">
          <span className="h-1.5 w-1.5 bg-dim" />
          Replay · idle
        </Pill>
      </Group>

      <Group>
        <Pill tone="amber">
          <span className="h-1.5 w-1.5 bg-accent" />
          <span className="num">
            LIVE · {hh}:{mm}:{ss}.{ms}
          </span>
        </Pill>
        <SoundToggle />
        <IconBtn>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="1.4" fill="currentColor" />
            <path
              d="M5 1v1.4M5 7.6V9M1 5h1.4M7.6 5H9M2.2 2.2l1 1M6.8 6.8l1 1M2.2 7.8l1-1M6.8 3.2l1-1"
              stroke="currentColor"
              strokeWidth="0.8"
            />
          </svg>
        </IconBtn>
      </Group>
    </header>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center gap-3 border-l border-border px-4 first:border-l-0">
      {children}
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "amber" | "dim";
}) {
  const cls =
    tone === "amber"
      ? "border-accent/40 text-accent"
      : "border-border text-muted";
  return (
    <span
      className={`inline-flex h-6 items-center gap-2 border ${cls} px-2.5 text-[11px] uppercase tracking-[0.1em]`}
    >
      {children}
    </span>
  );
}

function IconBtn({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-6 w-6 items-center justify-center border border-border text-muted hover:text-fg"
    >
      {children}
    </button>
  );
}
