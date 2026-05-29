"use client";

import { AnimatePresence, motion } from "motion/react";

import { AgentCard } from "@/components/agent-card";
import { SpawnAgentDialog } from "@/components/spawn-agent-dialog";
import { DUR, EASE } from "@/lib/motion";
import { useStore, type AgentRow } from "@/lib/store";

export function AgentsPane({ agents }: { agents: AgentRow[] }) {
  const aliveCount = agents.filter((a) => a.status !== "killed").length;
  const mode = useStore((s) => s.mode);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-center justify-between border-b border-border px-4">
        <span
          className="text-[11px] uppercase tracking-[0.12em] text-muted"
          title={`${aliveCount} alive accounts of ${agents.length} total. Killed accounts stay in the ledger (transactions still reference them) but can no longer authorize or receive funds.`}
        >
          {mode === "self" ? "Your accounts" : "Accounts"} · {aliveCount} / {agents.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="px-4 py-6 text-[11px] leading-relaxed text-muted">
            {mode === "self" ? (
              <>
                <div className="num mb-2 text-[10px] uppercase tracking-[0.12em] text-accent">
                  seeding your tenant…
                </div>
                Eight accounts and a day of history are being staged. Should
                land in a second.
              </>
            ) : (
              <>bootstrapping demo tenant…</>
            )}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {agents.map((a) => (
              <motion.div
                key={a.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
              >
                <AgentCard agent={a} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className="border-t border-border bg-[rgba(245,158,11,0.03)]">
        <SpawnAgentDialog />
      </div>
    </div>
  );
}
