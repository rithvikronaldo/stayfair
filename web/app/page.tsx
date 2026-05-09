"use client";

import { useEffect } from "react";

import { AgentsPane } from "@/components/agents-pane";
import { LandingStrip } from "@/components/landing-strip";
import { ScrubberShell } from "@/components/scrubber-shell";
import { TopBar } from "@/components/topbar";
import { TransactionStream } from "@/components/transaction-stream";
import { TreasuryCenter } from "@/components/treasury-center";
import { useEventStream } from "@/lib/event-stream";
import { useSpendDriver } from "@/lib/driver";
import { useStore } from "@/lib/store";

export default function Home() {
  useEventStream();
  useSpendDriver();

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

        <ScrubberShell />
      </div>

      <div className="vignette" />
    </div>
  );
}
