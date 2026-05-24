"use client";

import { useEffect } from "react";

import { AgentsPane } from "@/components/agents-pane";
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
import { useSelfModePolling } from "@/lib/self-mode";
import { useStore } from "@/lib/store";
import { useTimeSkip } from "@/lib/time-skip";

export default function Home() {
  useEventStream();      // SSE for demo mode; auto-skips in self mode + REPLAY
  useSpendDriver();      // simulator for demo mode; auto-skips in self mode + REPLAY
  useSelfModePolling();  // /agents + /balance polling for self mode; auto-skips in demo + REPLAY
  useScrubberRewind();   // takes over balances when scrubber's asOf is non-null
  const replay = useReplayQueue(); // fetches event queue when asOf non-null
  const timeSkip = useTimeSkip(replay); // orchestrates The Time Skip (W5 D5)

  const agents = useStore((s) => s.agents);
  const txs = useStore((s) => s.txs);
  const block = useStore((s) => s.block);
  const totalUsd = useStore((s) => s.totalUsd);
  const totalFlash = useStore((s) => s.totalFlash);
  const decayFlashes = useStore((s) => s.decayFlashes);

  useEffect(() => {
    const id = setInterval(decayFlashes, 200);
    return () => clearInterval(id);
  }, [decayFlashes]);

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
          txCount={1247 + txs.length}
          block={block}
        />

        <main className="grid grid-cols-[280px_1fr_360px] overflow-hidden">
          <section className="border-r border-border">
            <AgentsPane agents={agents} />
          </section>

          <section className="overflow-hidden">
            <TreasuryCenter
              totalUsd={totalUsd}
              flash={totalFlash}
              agents={agents}
            />
          </section>

          <section className="border-l border-border">
            <TransactionStream txs={txs} />
          </section>
        </main>

        <ScrubberShell timeSkip={timeSkip} />
      </div>

      <WelcomeSidebar />
      <ReplayBanner timeSkip={timeSkip} />
      <TakeOffChart />

      {inReplay && <div className="replay-tint" />}

      <div className="vignette" />
    </div>
  );
}
