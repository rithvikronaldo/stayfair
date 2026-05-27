"use client";

import { AnimatePresence, motion } from "motion/react";

import { DUR, EASE } from "@/lib/motion";
import { useStore } from "@/lib/store";
import type { UseTimeSkipApi } from "@/lib/time-skip";

// ReplayBanner is the replay HUD. It's visible the ENTIRE time a Time Skip is
// happening (rewinding → buffering → playing → done), not just at the end —
// so the user always knows "this is a replay, here's what's happening, here's
// how far along." Without this the rewind+playback just looks like the page
// flickering. Top-center, dashboard visible behind it. "Back to LIVE" is
// always available so there's a clear exit at any moment.

const REPLAY_AGAIN_MIN = 5;

export function ReplayBanner({ timeSkip }: { timeSkip: UseTimeSkipApi }) {
  const phase = useStore((s) => s.timeSkipPhase);
  const cursor = useStore((s) => s.timeSkipCursor);
  const total = useStore((s) => s.timeSkipTotal);

  const visible = phase !== "idle";
  const isDone = phase === "done";
  const isPlaying = phase === "playing" || phase === "paused";
  const pct = total > 0 ? Math.min(100, Math.round((cursor / total) * 100)) : 0;

  let label = "";
  let sub = "";
  if (phase === "rewinding") {
    label = "⏪ Rewinding";
    sub = "jumping back in time…";
  } else if (phase === "buffering") {
    label = "⏳ Loading replay";
    sub = "fetching events…";
  } else if (phase === "playing") {
    label = "▶ Replaying";
    sub = `${cursor} / ${total} transactions`;
  } else if (phase === "paused") {
    label = "⏸ Paused";
    sub = `${cursor} / ${total} transactions`;
  } else if (phase === "done") {
    label = "✓ Replay complete";
    sub = `${total} ${total === 1 ? "transaction" : "transactions"} replayed`;
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
          className="absolute left-1/2 top-20 z-30 w-[300px] -translate-x-1/2 border border-accent bg-bg/95 px-5 py-4 shadow-[0_4px_24px_rgba(245,158,11,0.22)] backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-2.5">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${isPlaying ? "live-breathe" : ""}`}
                style={{ background: "var(--accent)" }}
              />
              <span className="num text-[12px] tracking-[0.14em] text-accent uppercase">
                {label}
              </span>
            </div>

            <div className="num text-[11px] tracking-[0.06em] text-muted">
              {sub}
            </div>

            {/* Live progress bar — the clearest signal that something real is
                advancing, and how far it's gotten. */}
            {(isPlaying || isDone) && total > 0 && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-border-2">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: isDone ? "var(--neon)" : "var(--accent)" }}
                  animate={{ width: `${isDone ? 100 : pct}%` }}
                  transition={{ duration: DUR.ui, ease: EASE.outQuart }}
                />
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {isDone && (
                <button
                  type="button"
                  onClick={() => timeSkip.replayLast(REPLAY_AGAIN_MIN)}
                  className="num flex h-8 items-center justify-center border border-accent px-3 text-[11px] uppercase tracking-[0.14em] text-accent hover:bg-accent/10"
                >
                  ▶ Replay again
                </button>
              )}
              <button
                type="button"
                onClick={() => timeSkip.snapToNow()}
                className="num flex h-8 items-center justify-center border border-border px-3 text-[11px] uppercase tracking-[0.14em] text-fg hover:border-accent"
              >
                ← Back to LIVE
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
