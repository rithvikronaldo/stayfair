"use client";

import { useEffect, useRef, useState } from "react";

import { CurlHint } from "@/components/curl-hint";
import { API_URL } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { fmtSmartTime } from "@/lib/format";
import { EASE } from "@/lib/motion";
import { playTickIfUnmuted } from "@/lib/sound";
import { useStore, type TimeSkipSpeed } from "@/lib/store";
import type { UseTimeSkipApi } from "@/lib/time-skip";

// While dragging, setAsOf at most once every DRAG_THROTTLE_MS so the
// dashboard's balance refetches don't stampede the network. Roughly
// 8 fetches/sec — enough for visual tracking, light enough to coast.
const DRAG_THROTTLE_MS = 120;

// Tactile tick at most every DRAG_TICK_MS so a slow drag doesn't fire a
// continuous tone. Independent of the setAsOf throttle.
const DRAG_TICK_MS = 90;

// Preset stops the scrubber click-snaps to. Continuous drag (W5 D4) coexists
// with these — drop-position lands wherever the user lifts the pointer, but
// the preset labels keep the common offsets one-click away.
const PRESETS: { label: string; minutesBack: number }[] = [
  { label: "−1h", minutesBack: 60 },
  { label: "−15m", minutesBack: 15 },
  { label: "−5m", minutesBack: 5 },
];

const REPLAY_DEFAULT_MIN = 5;
const SPEEDS: TimeSkipSpeed[] = [1, 10, 100, 1000];

// SCRUB_WINDOW_MIN is the leftmost edge of the scrubber, in minutes back from
// NOW. Drag positions are linearly mapped into this window.
const SCRUB_WINDOW_MIN = 60;

const REWIND_TRANSITION = `left 600ms cubic-bezier(${EASE.outExpo.join(",")})`;
const STANDARD_TRANSITION = "left 300ms ease";

export function ScrubberShell({ timeSkip }: { timeSkip: UseTimeSkipApi }) {
  const asOf = useStore((s) => s.asOf);
  const setAsOf = useStore((s) => s.setAsOf);
  const phase = useStore((s) => s.timeSkipPhase);
  const speed = useStore((s) => s.timeSkipSpeed);
  const cursor = useStore((s) => s.timeSkipCursor);
  const total = useStore((s) => s.timeSkipTotal);
  const apiKey = useApiKey((s) => s.apiKey);
  const [now, setNow] = useState<Date | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Drag-preview percent. null = not dragging; number = playhead-during-drag.
  // setAsOf is throttled during drag (see DRAG_THROTTLE_MS) so balances
  // animate seamlessly without stampeding the network.
  const [dragPct, setDragPct] = useState<number | null>(null);
  const lastAsOfCommitRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  // Live clock for the LIVE/REPLAY indicator. Starts null so SSR + first
  // client render match — the timestamp populates on mount.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const isLive = asOf === null;
  const isPlaying = phase === "playing";
  const isPaused = phase === "paused";
  const isRewinding = phase === "rewinding" || phase === "buffering";
  const inOrchestrated = isPlaying || isPaused || isRewinding;
  // Drag and presets are locked while the orchestrator is driving — clicking
  // a preset mid-playback would race the timer.
  const presetsDisabled = inOrchestrated;

  function jumpBack(minutesBack: number) {
    if (presetsDisabled) return;
    setAsOf(new Date(Date.now() - minutesBack * 60 * 1000));
  }
  function snapToNow() {
    timeSkip.snapToNow();
  }

  function pctFromEvent(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 100;
    const raw = ((clientX - rect.left) / rect.width) * 100;
    return Math.max(0, Math.min(100, raw));
  }

  function asOfFromPct(pct: number): Date | null {
    // Snap-to-LIVE only when the user releases within the last 1% of the
    // track — keeps "drag to rewind 30s" usable without the playhead
    // bouncing back to NOW the moment they let go near the right edge.
    if (pct >= 99) return null;
    const minutesBack = ((100 - pct) / 100) * SCRUB_WINDOW_MIN;
    return new Date(Date.now() - minutesBack * 60_000);
  }

  function commitAsOfForDrag(pct: number) {
    const t = performance.now();
    if (t - lastAsOfCommitRef.current < DRAG_THROTTLE_MS) return;
    lastAsOfCommitRef.current = t;
    setAsOf(asOfFromPct(pct));
  }

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (presetsDisabled) return;
    // Ignore drags that start on a child button (the preset stops). Their
    // onClick handles the action; bubbling here would race with us.
    if (e.target !== e.currentTarget) return;
    trackRef.current?.setPointerCapture(e.pointerId);
    const pct = pctFromEvent(e.clientX);
    setDragPct(pct);
    // Reset throttle so the very first move commits immediately.
    lastAsOfCommitRef.current = 0;
    lastTickRef.current = 0;
    commitAsOfForDrag(pct);
    playTickIfUnmuted();
  }
  function onTrackPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragPct === null) return;
    const pct = pctFromEvent(e.clientX);
    setDragPct(pct);
    commitAsOfForDrag(pct);
    const t = performance.now();
    if (t - lastTickRef.current >= DRAG_TICK_MS) {
      lastTickRef.current = t;
      playTickIfUnmuted();
    }
  }
  function onTrackPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragPct === null) return;
    const finalPct = pctFromEvent(e.clientX);
    const finalAsOf = asOfFromPct(finalPct);
    // Force-commit the final position (throttle would otherwise drop it).
    lastAsOfCommitRef.current = 0;
    setAsOf(finalAsOf);
    setDragPct(null);
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released — fine */
    }
    // Auto-play forward from the released position. The user's mental model
    // is "drop here, then play to NOW" — like a video scrubber. Skipped when
    // the drop snapped to LIVE (finalAsOf=null) since there's nothing to play.
    if (finalAsOf !== null) {
      timeSkip.playFromAsOf();
    }
  }

  const playheadPct = dragPct !== null ? dragPct : playheadPosition(asOf);

  const replayCurl = `curl "${API_URL}/transactions?from=<5min_ago_iso>&to=<now_iso>" \\
  -H "Authorization: Bearer ${apiKey ?? "<your_api_key>"}"`;

  return (
    <div className="flex h-[72px] items-center gap-3 border-t border-border bg-bg px-5">
      {/* Replay trigger — the cinematic CTA. Left of NOW for prominence. */}
      <CurlHint curl={replayCurl} align="left">
        <button
          type="button"
          onClick={() => timeSkip.replayLast(REPLAY_DEFAULT_MIN)}
          disabled={isRewinding || isPlaying}
          className={`num flex h-8 items-center justify-center border px-3 text-[11px] uppercase tracking-[0.14em] ${
            isRewinding || isPlaying
              ? "cursor-default border-border text-dim"
              : "border-accent text-accent hover:bg-accent/10"
          }`}
          title="Replay the last 5 minutes"
        >
          ▶ REPLAY 5m
        </button>
      </CurlHint>

      {/* Snap-to-NOW button. Looks like the previous prev/next but plays a
          different role: it's the "back to live" affordance. */}
      <button
        type="button"
        onClick={snapToNow}
        disabled={isLive && !inOrchestrated}
        className={`num flex h-8 items-center justify-center border border-border px-3 text-[11px] uppercase tracking-[0.14em] ${
          isLive && !inOrchestrated
            ? "cursor-default text-dim"
            : "text-accent hover:border-accent"
        }`}
      >
        ▶ NOW
      </button>

      <div
        ref={trackRef}
        className={`relative flex-1 h-[72px] select-none ${
          presetsDisabled
            ? "cursor-default"
            : dragPct !== null
              ? "cursor-grabbing"
              : "cursor-grab"
        }`}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
      >
        {/* Baseline */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-border pointer-events-none" />

        {/* Neon line — fills from left up to the playhead. Uses inline style
            so the same ease curve as the playhead carries through. */}
        <div
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 mix-blend-difference pointer-events-none"
          style={{
            width: playheadPct + "%",
            background:
              "linear-gradient(90deg, rgba(34,211,238,0.05), rgba(34,211,238,1))",
            transition:
              dragPct === null
                ? isRewinding
                  ? `width 600ms cubic-bezier(${EASE.outExpo.join(",")})`
                  : "width 300ms ease"
                : undefined,
          }}
        />

        {/* Preset click-points. Each is a vertical hairline + clickable
            invisible button overlaid. NOW is the rightmost mark. */}
        {[
          ...PRESETS.map((p) => ({
            ...p,
            pos: percentForMinutesBack(p.minutesBack),
            kind: "preset" as const,
          })),
          { label: "NOW", minutesBack: 0, pos: 100, kind: "now" as const },
        ].map((m) => {
          const isSelected =
            m.kind === "now"
              ? isLive
              : asOf !== null &&
                Math.abs(
                  asOf.getTime() -
                    (Date.now() - m.minutesBack * 60 * 1000),
                ) < 1000;
          return (
            <button
              key={m.label}
              type="button"
              onClick={() =>
                m.kind === "now" ? snapToNow() : jumpBack(m.minutesBack)
              }
              disabled={presetsDisabled && m.kind !== "now"}
              className="absolute top-0 -translate-x-1/2 h-full flex flex-col items-center justify-center gap-1 disabled:cursor-default"
              style={{ left: `${m.pos}%` }}
            >
              <span
                className={`block w-px ${
                  isSelected ? "h-3 bg-accent" : "h-2 bg-border"
                }`}
              />
              <span
                className={`num text-[10px] tracking-[0.12em] ${
                  isSelected
                    ? m.kind === "now"
                      ? "text-accent"
                      : "text-fg"
                    : presetsDisabled && m.kind !== "now"
                      ? "text-dim/60"
                      : "text-dim hover:text-muted"
                }`}
              >
                {m.label}
              </span>
            </button>
          );
        })}

        {/* Playhead. Wrapped in a wider invisible hit area so it's easy to
            grab; the visible circle stays small but the user can drag from
            ~40px around it. During rewind, glides over 600ms with
            ease-out-expo. Otherwise eases over 300ms to the asOf position. */}
        <div
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
          className={`absolute top-0 -translate-x-1/2 flex h-full w-10 items-center justify-center ${
            presetsDisabled
              ? "cursor-default"
              : dragPct !== null
                ? "cursor-grabbing"
                : "cursor-grab"
          }`}
          style={{
            left: `${playheadPct}%`,
            transition:
              dragPct === null
                ? isRewinding
                  ? REWIND_TRANSITION
                  : STANDARD_TRANSITION
                : undefined,
          }}
        >
          <div
            className="mix-blend-difference pointer-events-none"
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "var(--bg)",
              border: "1.5px solid var(--neon)",
              boxShadow:
                "0 0 12px rgba(34,211,238,0.6), 0 0 0 4px rgba(10,10,11,0.8)",
            }}
          />
        </div>
      </div>

      {/* Right-side status / orchestrator controls. Three modes:
            - LIVE (asOf=null, idle): clock + LIVE pulse.
            - REPLAY scrubber-driven (asOf!=null, idle): timestamp + REPLAY tag.
            - playing/paused/rewinding: Play/Pause + speed pill + progress. */}
      <div className="num flex flex-col items-end gap-1 min-w-[180px]">
        {inOrchestrated ? (
          <OrchestratorPane
            phase={phase}
            speed={speed}
            cursor={cursor}
            total={total}
            onPlay={timeSkip.play}
            onPause={timeSkip.pause}
            onSpeed={timeSkip.setSpeed}
          />
        ) : isLive ? (
          <>
            <span className="live-breathe flex items-center gap-1.5 text-[13px] tracking-[0.06em] text-green">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--green)", boxShadow: "0 0 6px rgba(16,185,129,0.6)" }}
              />
              LIVE · 1.0×
            </span>
            <span className="text-[10px] tracking-[0.1em] text-dim">
              {now ? formatClock(now) : "--:--:--"}
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-[13px] tracking-[0.06em] text-accent">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              REPLAY
            </span>
            <span
              className="text-[10px] tracking-[0.1em] text-muted"
              title={asOf.toISOString()}
            >
              {now ? fmtSmartTime(asOf, now) : "—"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function OrchestratorPane({
  phase,
  speed,
  cursor,
  total,
  onPlay,
  onPause,
  onSpeed,
}: {
  phase: "rewinding" | "buffering" | "playing" | "paused" | string;
  speed: TimeSkipSpeed;
  cursor: number;
  total: number;
  onPlay: () => void;
  onPause: () => void;
  onSpeed: (s: TimeSkipSpeed) => void;
}) {
  const isPlaying = phase === "playing";
  const isRewindingOrBuffering = phase === "rewinding" || phase === "buffering";

  const label =
    phase === "rewinding"
      ? "REWINDING"
      : phase === "buffering"
        ? "BUFFERING"
        : phase === "paused"
          ? "PAUSED"
          : "REPLAY";

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={isRewindingOrBuffering}
          className="flex h-6 w-6 items-center justify-center border border-accent text-[10px] text-accent hover:bg-accent/10 disabled:cursor-default disabled:border-border disabled:text-dim"
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <span className="flex items-center gap-1.5 text-[13px] tracking-[0.06em] text-accent">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] tracking-[0.1em] text-dim">
        <div className="flex gap-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeed(s)}
              className={`px-1.5 py-0.5 text-[10px] tracking-[0.08em] ${
                speed === s
                  ? "bg-accent/15 text-accent"
                  : "text-dim hover:text-muted"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="text-muted">
          {cursor}/{total}
        </span>
      </div>
    </>
  );
}

// Playhead position as a percentage along the scrubber. NOW = 100%.
// −1h = the left edge (0%). Linear in between, clamped.
function playheadPosition(asOf: Date | null): number {
  if (asOf === null) return 100;
  const minutesBack = (Date.now() - asOf.getTime()) / 60000;
  return Math.max(0, 100 - (minutesBack / 60) * 100);
}

function percentForMinutesBack(minutesBack: number): number {
  return Math.max(0, 100 - (minutesBack / 60) * 100);
}

function formatClock(d: Date): string {
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC`;
}
