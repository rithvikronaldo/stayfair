"use client";

import { useEffect } from "react";

import { ActionDialog } from "@/components/action-dialog";
import { AgentsPane } from "@/components/agents-pane";
import { CommandPalette } from "@/components/command-palette";
import { LandingStrip } from "@/components/landing-strip";
import { ReplayBanner } from "@/components/replay-banner";
import { ScrubberShell } from "@/components/scrubber-shell";
import { TakeOffChart } from "@/components/take-off-chart";
import { TopBar } from "@/components/topbar";
import { TransactionStream } from "@/components/transaction-stream";
import { TreasuryCenter } from "@/components/treasury-center";
import { WelcomeSidebar } from "@/components/welcome-sidebar";
import { useEventStream } from "@/lib/event-stream";
import { useSpendDriver } from "@/lib/driver";
import { useReplayQueue } from "@/lib/replay-queue";
import { useScrubberRewind } from "@/lib/scrubber";
import { hydrateCodeMode } from "@/lib/code-mode";
import { useFirstTick } from "@/lib/first-tick";
import { useSelfModePolling } from "@/lib/self-mode";
import { useKeyboardShortcuts } from "@/lib/shortcuts";
import { useStore } from "@/lib/store";
import { useTimeSkip } from "@/lib/time-skip";

export default function Home() {
  useEventStream();      // SSE for demo mode; auto-skips in self mode + REPLAY
  useSpendDriver();      // simulator for demo mode; auto-skips in self mode + REPLAY
  useSelfModePolling();  // /agents + /balance polling for self mode; auto-skips in demo + REPLAY
  useFirstTick();        // The First Tick — keeps a new tenant alive for its first 5 min
  useScrubberRewind();   // takes over balances when scrubber's asOf is non-null
  const replay = useReplayQueue(); // fetches event queue when asOf non-null
  const timeSkip = useTimeSkip(replay); // orchestrates The Time Skip (W5 D5)
  useKeyboardShortcuts(timeSkip); // R=replay, S=stress, ?=palette, ⌘K=palette

  const agents = useStore((s) => s.agents);
  const txs = useStore((s) => s.txs);
  const totalUsd = useStore((s) => s.totalUsd);
  const totalFlash = useStore((s) => s.totalFlash);
  const decayFlashes = useStore((s) => s.decayFlashes);

  useEffect(() => {
    const id = setInterval(decayFlashes, 200);
    return () => clearInterval(id);
  }, [decayFlashes]);

  useEffect(() => {
    hydrateCodeMode();
  }, []);

  const ccyCount = new Set(agents.map((a) => a.currency)).size;
  const asOf = useStore((s) => s.asOf);
  const inReplay = asOf !== null;

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-bg text-fg">
      <div className="grid h-full grid-rows-[36px_40px_1fr_80px]">
        <LandingStrip />
        <TopBar
          agentCount={agents.filter((a) => a.status !== "killed").length}
          ccyCount={ccyCount}
          txCount={txs.length}
        />

        <main className="grid grid-rows-[minmax(0,1fr)] grid-cols-[280px_1fr_360px] overflow-hidden">
          <section className="overflow-hidden border-r border-border">
            <AgentsPane agents={agents} />
          </section>

          <section className="overflow-hidden">
            <TreasuryCenter
              totalUsd={totalUsd}
              flash={totalFlash}
              agents={agents}
            />
          </section>

          <section className="overflow-hidden border-l border-border">
            <TransactionStream txs={txs} />
          </section>
        </main>

        <ScrubberShell timeSkip={timeSkip} />
      </div>

      <WelcomeSidebar timeSkip={timeSkip} />
      <ReplayBanner timeSkip={timeSkip} />
      <TakeOffChart timeSkip={timeSkip} />
      <CommandPalette timeSkip={timeSkip} />
      <ActionDialog />

      {inReplay && <div className="replay-tint" />}

      <div className="vignette" />
    </div>
  );
}
