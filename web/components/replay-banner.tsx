"use client";

import { AnimatePresence, motion } from "motion/react";

import { DUR, EASE } from "@/lib/motion";
import { useStore } from "@/lib/store";
import type { UseTimeSkipApi } from "@/lib/time-skip";

// ReplayBanner appears after the Time Skip playback completes (phase = "done")
// and offers two next actions: replay again, or return to LIVE. Mid-top
// placement keeps the dashboard visible behind it. Dismiss is implicit —
// clicking either button moves the phase out of "done".
//
// Cold-visitor copy variant (sign-up CTA) lands in the next iteration of the
// new-user flow (W6 D1). Today's banner is mode-neutral.

const REPLAY_AGAIN_MIN = 5;

export function ReplayBanner({ timeSkip }: { timeSkip: UseTimeSkipApi }) {
  const phase = useStore((s) => s.timeSkipPhase);
  const total = useStore((s) => s.timeSkipTotal);
  const visible = phase === "done";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
          className="absolute left-1/2 top-20 z-30 -translate-x-1/2 border border-accent bg-bg/95 px-6 py-4 shadow-[0_4px_24px_rgba(34,211,238,0.18)] backdrop-blur"
          role="status"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <span className="num text-[12px] tracking-[0.14em] text-accent uppercase">
                Replay complete
              </span>
            </div>
            <div className="num text-[11px] tracking-[0.06em] text-muted">
              {total} {total === 1 ? "event" : "events"} replayed
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => timeSkip.replayLast(REPLAY_AGAIN_MIN)}
                className="num flex h-8 items-center justify-center border border-accent px-3 text-[11px] uppercase tracking-[0.14em] text-accent hover:bg-accent/10"
              >
                ▶ Replay again
              </button>
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
