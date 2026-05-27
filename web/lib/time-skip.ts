"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { ReplayEvent, ReplayQueueState } from "@/lib/replay-queue";
import { useStore, type TimeSkipSpeed } from "@/lib/store";

// useTimeSkip orchestrates The Time Skip choreography (W5 D5). It owns the
// state machine: idle → rewinding → buffering → playing → done. Pause moves
// playing → paused; snapToNow tears everything down back to idle/LIVE.
//
// Substrate composition:
//   - useReplayQueue (the data layer) fetches the queue when asOf changes.
//     It's caller-owned because page.tsx already mounts it; we just receive
//     its current state as an argument.
//   - useScrubberRewind (already mounted on page.tsx) takes care of the
//     balance count-back the moment asOf is set, by re-fetching every
//     account's balance at the historical timestamp. useAnimatedNumber in
//     the agent cards then tweens to those new values — that's the
//     "synchronized count-back" the cinematic spec describes, for free.
//   - applyReplayEvent (store) is fired once per event during playback to
//     apply forward balance deltas and stream the tx row.
//
// Time pacing: each inter-event gap is the real-time gap between
// occurred_at timestamps divided by speed, clamped to [MIN_GAP, MAX_GAP] so
// long-tail gaps don't freeze the screen and 1000× doesn't produce a
// vibration that the browser can't render.

const REWIND_MS = 700;
const MIN_GAP_MS = 40;
const MAX_GAP_MS = 600;

export type UseTimeSkipApi = {
  replayLast: (minutes: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: TimeSkipSpeed) => void;
  snapToNow: () => void;
};

export function useTimeSkip(replay: ReplayQueueState): UseTimeSkipApi {
  const timerRef = useRef<number | null>(null);
  const cursorRef = useRef<number>(0);
  const queueRef = useRef<ReplayEvent[]>([]);

  useEffect(() => {
    queueRef.current = replay.queue;
  }, [replay.queue]);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function gapForSpeed(
    curIdx: number,
    nextIdx: number,
    speed: TimeSkipSpeed,
  ): number {
    const cur = queueRef.current[curIdx];
    const next = queueRef.current[nextIdx];
    if (!cur || !next) return MIN_GAP_MS;
    const rawMs = next.occurredAt.getTime() - cur.occurredAt.getTime();
    return Math.max(MIN_GAP_MS, Math.min(MAX_GAP_MS, rawMs / speed));
  }

  const step = useCallback(() => {
    const s = useStore.getState();
    if (s.timeSkipPhase !== "playing") return;

    const queue = queueRef.current;
    const cur = cursorRef.current;
    if (cur >= queue.length) {
      s.setTimeSkipPhase("done");
      return;
    }

    s.applyReplayEvent(queue[cur].tx);
    const nextCursor = cur + 1;
    cursorRef.current = nextCursor;
    s.setTimeSkipCursor(nextCursor, queue.length);

    if (nextCursor >= queue.length) {
      s.setTimeSkipPhase("done");
      return;
    }

    const gap = gapForSpeed(cur, nextCursor, s.timeSkipSpeed);
    timerRef.current = window.setTimeout(step, gap);
  }, []);

  // Bridge: whenever the phase becomes "playing", start the step loop. When
  // it leaves "playing" (paused / done / snapped), tear the timer down. The
  // cursor lives in a ref so resume picks up where pause left off.
  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (state.timeSkipPhase === prev.timeSkipPhase) return;
      if (state.timeSkipPhase === "playing") {
        clearTimer();
        timerRef.current = window.setTimeout(step, MIN_GAP_MS);
      } else {
        clearTimer();
      }
    });
    return () => {
      unsub();
      clearTimer();
    };
  }, [step]);

  // Buffering watcher: once we're in buffering and the fetch has settled,
  // either promote to playing (events found) or — crucially — bail out if the
  // window is EMPTY. Without the empty branch the orchestrator hangs in
  // buffering forever on a quiet ledger (rewound, tinted, nothing to play).
  // Subscribing to phase (not just reading via getState) makes this re-run on
  // the rewinding→buffering transition regardless of fetch/phase ordering.
  const phase = useStore((s) => s.timeSkipPhase);
  useEffect(() => {
    if (phase !== "buffering" || replay.isLoading) return;
    const s = useStore.getState();
    if (replay.queue.length > 0) {
      s.setTimeSkipCursor(0, replay.queue.length);
      s.setTimeSkipPhase("playing");
    } else {
      toast("Nothing to replay", {
        description: "No activity on this ledger in the last few minutes.",
      });
      s.setTimeSkipPhase("idle");
      s.clearReplayState();
      s.setAsOf(null);
    }
  }, [phase, replay.queue.length, replay.isLoading]);

  const replayLast = useCallback((minutes: number) => {
    clearTimer();
    cursorRef.current = 0;
    const s = useStore.getState();
    s.clearReplayState();
    s.setTimeSkipCursor(0, 0);
    s.setTimeSkipPhase("rewinding");
    s.setAsOf(new Date(Date.now() - minutes * 60_000));

    window.setTimeout(() => {
      const cur = useStore.getState();
      if (cur.timeSkipPhase !== "rewinding") return;
      if (queueRef.current.length > 0) {
        cur.setTimeSkipCursor(0, queueRef.current.length);
        cur.setTimeSkipPhase("playing");
      } else {
        cur.setTimeSkipPhase("buffering");
      }
    }, REWIND_MS);
  }, []);

  const play = useCallback(() => {
    useStore.getState().setTimeSkipPhase("playing");
  }, []);

  const pause = useCallback(() => {
    useStore.getState().setTimeSkipPhase("paused");
  }, []);

  const setSpeed = useCallback((speed: TimeSkipSpeed) => {
    useStore.getState().setTimeSkipSpeed(speed);
  }, []);

  const snapToNow = useCallback(() => {
    clearTimer();
    cursorRef.current = 0;
    const s = useStore.getState();
    s.setTimeSkipPhase("idle");
    s.clearReplayState();
    s.setAsOf(null);
  }, []);

  return { replayLast, play, pause, setSpeed, snapToNow };
}
