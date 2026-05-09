"use client";

import { AgentsPane } from "@/components/agents-pane";
import { ScrubberShell } from "@/components/scrubber-shell";
import { TopBar } from "@/components/topbar";
import { TransactionStream } from "@/components/transaction-stream";
import { TreasuryCenter } from "@/components/treasury-center";
import { useSimulator } from "@/lib/sim";

export default function Home() {
  const { agents, txs, block, totalUsd, totalFlash } = useSimulator();
  const ccyCount = new Set(agents.map((a) => a.currency)).size;

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-bg text-fg">
      <div className="grid h-full grid-rows-[40px_1fr_80px]">
        <TopBar
          agentCount={agents.filter((a) => a.alive).length}
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
