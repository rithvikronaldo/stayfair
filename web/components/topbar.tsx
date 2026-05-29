"use client";

import { useEffect, useState } from "react";

import { CurlHint } from "@/components/curl-hint";
import { SoundToggle } from "@/components/sound-toggle";
import { useActionDialog } from "@/lib/action-dialog";
import { API_URL } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { useCodeMode } from "@/lib/code-mode";
import { useCommandPalette } from "@/lib/command-palette";
import { useStore } from "@/lib/store";
import { useStressRun, STRESS_DEFAULT_N } from "@/lib/stress";

export function TopBar({
  agentCount,
  ccyCount,
  txCount,
}: {
  agentCount: number;
  ccyCount: number;
  txCount: number;
}) {
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
        <span
          className="num text-[11px] uppercase tracking-[0.1em] text-dim"
          title="Double-entry bookkeeping: every transaction posts two or more entries that sum to zero. USD is the base currency — non-USD balances are FX-converted to USD at the as-of timestamp for the headline total."
        >
          DOUBLE-ENTRY · USD BASE
        </span>
      </Group>

      <Group>
        <span
          className="num text-[11px] uppercase tracking-[0.1em] text-dim"
          title={`${agentCount} alive account${agentCount === 1 ? "" : "s"} in your tenant · ${ccyCount} distinct currenc${ccyCount === 1 ? "y" : "ies"} · ${txCount} transaction${txCount === 1 ? "" : "s"} currently in the live feed buffer (capped at 30 — not your tenant's total tx count)`}
        >
          {agentCount} ACCOUNTS · {ccyCount} CCY · FEED{" "}
          {txCount.toLocaleString("en-US")}
        </span>
      </Group>

      <div className="flex-1" />

      <Group>
        <NewButton />
        <CmdKButton />
        <CodeModeToggle />
        <StressButton />
      </Group>

      <Group>
        <LivePill />
        <SoundToggle />
      </Group>
    </header>
  );
}

// LivePill owns its own ticking clock so the rest of the topbar
// (and its memo-resistant grandchildren like StressButton / SoundToggle)
// is not re-rendered five times a second.
function LivePill() {
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
    <Pill tone="amber">
      <span className="h-1.5 w-1.5 bg-accent" />
      <span
        className="num"
        title="Live mode · UTC wall-clock. The dashboard polls /agents and /balance every 5 seconds; the scrubber and ▶ REPLAY 5m switch into historical (as_of) mode and pause polling."
      >
        LIVE · {hh}:{mm}:{ss}.{ms}
      </span>
    </Pill>
  );
}

function StressButton() {
  const stress = useStressRun();
  const apiKey = useApiKey((s) => s.apiKey);
  const phase = useStore((s) => s.stressPhase);
  const running = phase === "running";
  const signedIn = Boolean(apiKey);
  const curl = `curl -X POST ${API_URL}/stress \\
  -H "Authorization: Bearer ${apiKey ?? "<your_api_key>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"n": ${STRESS_DEFAULT_N}}'`;
  const disabled = running || !signedIn;
  return (
    <CurlHint curl={curl}>
      <button
        type="button"
        onClick={() => stress.run(STRESS_DEFAULT_N)}
        disabled={disabled}
        title={
          !signedIn
            ? "Sign up for an API key to run a stress test on your own tenant"
            : running
              ? "Stress test running"
              : "Bulk-post 1,000 balanced transactions to your tenant"
        }
        className={`num inline-flex h-6 items-center gap-2 border px-2.5 text-[11px] uppercase tracking-[0.1em] ${
          disabled
            ? "border-border text-dim cursor-not-allowed"
            : "border-accent text-accent hover:bg-accent/10"
        }`}
      >
        <span
          className="h-1.5 w-1.5"
          style={{ background: disabled ? "var(--dim)" : "var(--accent)" }}
        />
        {running ? "Stress · running" : "▶ Stress 1k"}
      </button>
    </CurlHint>
  );
}

function NewButton() {
  const openDialog = useActionDialog((s) => s.openDialog);
  const apiKey = useApiKey((s) => s.apiKey);
  const signedIn = Boolean(apiKey);
  return (
    <button
      type="button"
      onClick={() => signedIn && openDialog("post")}
      disabled={!signedIn}
      title={
        signedIn
          ? "Spawn an account or post a transaction"
          : "Sign up for an API key to spawn accounts or post transactions"
      }
      className={`num inline-flex h-6 items-center gap-1.5 border px-2.5 text-[11px] uppercase tracking-[0.1em] ${
        signedIn
          ? "border-border text-muted hover:text-fg"
          : "border-border text-dim cursor-not-allowed"
      }`}
    >
      + New
    </button>
  );
}

function CodeModeToggle() {
  const on = useCodeMode((s) => s.on);
  const toggle = useCodeMode((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title="Code mode — reveal the curl behind each action"
      className={`num inline-flex h-6 items-center gap-1.5 border px-2.5 text-[11px] uppercase tracking-[0.1em] ${
        on
          ? "border-accent text-accent"
          : "border-border text-muted hover:text-fg"
      }`}
    >
      {"</>"} Code
    </button>
  );
}

function CmdKButton() {
  const setOpen = useCommandPalette((s) => s.setOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Command palette (⌘K)"
      className="num inline-flex h-6 items-center gap-1.5 border border-border px-2 text-[11px] uppercase tracking-[0.1em] text-muted hover:text-fg"
    >
      <span>⌘K</span>
    </button>
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

