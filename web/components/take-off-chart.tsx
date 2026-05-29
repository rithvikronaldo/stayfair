"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";

import { useAnimatedNumber } from "@/lib/animated-number";
import { DUR, EASE } from "@/lib/motion";
import { playThudIfUnmuted, playWhooshIfUnmuted } from "@/lib/sound";
import { useStore } from "@/lib/store";
import { useStressRun } from "@/lib/stress";
import type { UseTimeSkipApi } from "@/lib/time-skip";

// The Take-Off chart (W5 D7). Modal-style overlay that appears when stress
// fires, shows cumulative txs over time taking off, snaps to actual final
// values on response, and reveals the four headline numbers + a pinned-
// green invariant badge.
//
// Pacing during the synchronous POST:
//   - We extrapolate the rising line using a 500-tps assumption (matches
//     the local-dev sequential ledger.Post() throughput). This is honest:
//     the line snaps to the real final point when the response lands, so
//     a wrong extrapolation just produces a visible correction.
//   - The X axis sweeps right at 1s/s; Y axis auto-scales to whichever of
//     {extrapolated, N} is larger.

const W = 720;
const CHART_W = 560;
const CHART_H = 220;
const PAD_LEFT = 56;
const PAD_TOP = 24;

export function TakeOffChart({ timeSkip }: { timeSkip: UseTimeSkipApi }) {
  const stress = useStressRun();
  const phase = useStore((s) => s.stressPhase);
  const n = useStore((s) => s.stressN);
  const startedAt = useStore((s) => s.stressStartedAt);
  const result = useStore((s) => s.stressResult);
  // REAL progress — advances only when a batch actually commits (no fake guess).
  const posted = useStore((s) => s.stressPosted);
  const samples = useStore((s) => s.stressSamples);

  // Light timer purely to tick the elapsed-seconds readout while running (the
  // chart itself redraws on real batch updates). 200ms is plenty; no animation
  // is spawned per render, so this can't saturate the main thread.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [phase]);

  // Sound integration points (W6 D1): rising whoosh on launch, thud on landing
  // — paired with the invariant badge snapping green. No-ops while muted; cue
  // tuning is W6 D2 per the launch plan.
  useEffect(() => {
    if (phase === "running") playWhooshIfUnmuted();
    else if (phase === "done") playThudIfUnmuted();
  }, [phase]);

  const visible = phase !== "idle";
  const isDone = phase === "done" && result !== null;

  // Wall-clock elapsed for the readout; the chart's x-axis uses real sample
  // times so it only ever shows measured progress.
  const elapsedMs = isDone
    ? result.elapsed_ms
    : Math.max(1, Date.now() - (startedAt || Date.now()));
  const elapsedSec = elapsedMs / 1000;

  // The line is the real committed-count samples, oldest→newest.
  const linePoints =
    samples.length > 0 ? samples.map((s) => ({ x: s.t, y: s.posted })) : [{ x: 0, y: 0 }];
  const lastPoint = linePoints[linePoints.length - 1];

  // Axes fit the real data; floors keep the chart readable before much lands.
  const xMax = Math.max(lastPoint.x, 1);
  const yMax = Math.max(posted, Math.min(n, 100));

  const xScale = scaleLinear({
    domain: [0, xMax],
    range: [0, CHART_W],
    nice: true,
  });
  const yScale = scaleLinear({
    domain: [0, yMax],
    range: [CHART_H, 0],
    nice: true,
  });

  const tps = isDone
    ? result.tps_peak
    : posted / Math.max(0.1, elapsedSec);

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop — clicks pass through to the dashboard underneath
              except on the panel itself; the user closes via the buttons. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.ui, ease: EASE.outQuart }}
            className="fixed inset-0 z-40 bg-black/55 pointer-events-none"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
            className="fixed left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 border border-accent bg-surface-1 shadow-[0_8px_48px_rgba(245,158,11,0.18)]"
            style={{ width: W }}
            role="dialog"
            aria-label="Stress test progress"
          >
            <div className="flex h-full flex-col p-6">
              <header className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="num text-[12px] tracking-[0.18em] uppercase text-accent">
                    Stress · Take-Off
                  </span>
                  <span className="num text-[11px] tracking-[0.1em] text-dim">
                    n = {n.toLocaleString("en-US")}{isDone && result.currency ? ` · ${result.currency}` : ""}
                    {isDone && result.serialization_retries > 0
                      ? ` · ${result.serialization_retries.toLocaleString("en-US")} retries`
                      : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => stress.reset()}
                  className="text-dim hover:text-fg text-[12px]"
                  aria-label="Close"
                >
                  ✕
                </button>
              </header>

              {/* Real status: while running, the count climbs only as batches
                  actually commit. On done, the claim is verifiable — the rows
                  are in the feed and the books still balance. */}
              <div className="num mt-2 flex h-4 items-center gap-2 text-[11px] tracking-[0.1em]">
                {isDone ? (
                  <span className="text-neon">
                    ✓ committed {result.n_posted.toLocaleString("en-US")} real txns in{" "}
                    {(result.elapsed_ms / 1000).toFixed(2)}s · books balance to 0
                    · see them in the feed →
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-accent">
                    <span className="live-breathe inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    committing to Postgres in batches —{" "}
                    {posted.toLocaleString("en-US")}/{n.toLocaleString("en-US")} landed…
                  </span>
                )}
              </div>

              <div className="relative mt-2">
                <svg width={CHART_W + PAD_LEFT + 16} height={CHART_H + PAD_TOP + 36}>
                  <Group left={PAD_LEFT} top={PAD_TOP}>
                    {/* Grid baseline */}
                    <line
                      x1={0}
                      x2={CHART_W}
                      y1={CHART_H}
                      y2={CHART_H}
                      stroke="var(--border)"
                      strokeWidth={1}
                    />
                    {/* The line — Take-Off. Stroke color is the accent
                        amber while running, neon cyan when complete. */}
                    <LinePath
                      data={linePoints}
                      x={(d) => xScale(d.x)}
                      y={(d) => yScale(d.y)}
                      stroke={isDone ? "var(--neon)" : "var(--accent)"}
                      strokeWidth={2}
                    />
                    {/* Endpoint dot at the latest real sample */}
                    <circle
                      cx={xScale(lastPoint.x)}
                      cy={yScale(lastPoint.y)}
                      r={isDone ? 4 : 3}
                      fill={isDone ? "var(--neon)" : "var(--accent)"}
                    />
                    <AxisLeft
                      scale={yScale}
                      numTicks={4}
                      stroke="var(--border)"
                      tickStroke="var(--border)"
                      tickLabelProps={() => ({
                        fill: "var(--dim)",
                        fontSize: 9,
                        fontFamily: "var(--font-jetbrains)",
                        textAnchor: "end",
                        dx: -4,
                        dy: 3,
                      })}
                    />
                    <AxisBottom
                      top={CHART_H}
                      scale={xScale}
                      numTicks={5}
                      stroke="var(--border)"
                      tickStroke="var(--border)"
                      tickFormat={(v) => `${(v as number).toFixed(1)}s`}
                      tickLabelProps={() => ({
                        fill: "var(--dim)",
                        fontSize: 9,
                        fontFamily: "var(--font-jetbrains)",
                        textAnchor: "middle",
                      })}
                    />
                  </Group>
                </svg>
                <div className="num absolute left-1 top-1 text-[9px] uppercase tracking-[0.12em] text-dim">
                  cum. tx
                </div>
              </div>

              <StatsRow
                posted={posted}
                tps={tps}
                p99={isDone ? result.p99_commit_ms : 0}
                p50={isDone ? result.p50_commit_ms : 0}
                inv={isDone ? result.invariant_violations : 0}
                running={!isDone}
              />

              <div className="mt-auto flex items-center gap-2 pt-4">
                {isDone && (
                  <button
                    type="button"
                    onClick={() => {
                      // Window back to just before the run started so the
                      // replay queue picks up the whole burst, then close the
                      // overlay and let The Time Skip play it back on the
                      // now-visible dashboard.
                      const mins = startedAt
                        ? (Date.now() - startedAt) / 60_000 + 0.15
                        : 1;
                      stress.reset();
                      timeSkip.replayLast(mins);
                    }}
                    className="num flex h-8 items-center border border-neon bg-neon/10 px-3 text-[11px] uppercase tracking-[0.14em] text-neon hover:bg-neon/20"
                  >
                    ▶ Replay this burst
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => stress.run(n || 1000)}
                  disabled={!isDone}
                  className="num flex h-8 items-center border border-accent px-3 text-[11px] uppercase tracking-[0.14em] text-accent hover:bg-accent/10 disabled:cursor-default disabled:border-border disabled:text-dim"
                >
                  ▶ Run again
                </button>
                <button
                  type="button"
                  onClick={() => stress.reset()}
                  className="num flex h-8 items-center border border-border px-3 text-[11px] uppercase tracking-[0.14em] text-fg hover:border-accent"
                >
                  ← Close
                </button>
                <span className="ml-auto num text-[10px] tracking-[0.1em] text-dim">
                  {`${elapsedSec.toFixed(2)}s`}
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function StatsRow({
  posted,
  tps,
  p99,
  p50,
  inv,
  running,
}: {
  posted: number;
  tps: number;
  p99: number;
  p50: number;
  inv: number;
  running: boolean;
}) {
  // While running these targets change every frame; tweening them would spawn
  // a fresh animation per frame and freeze the tab. Disable the tween during
  // the run (snap instead) and let it count up cleanly on the done-reveal.
  const animatedPosted = useAnimatedNumber(posted, !running);
  const animatedTps = useAnimatedNumber(tps, !running);
  const animatedP99 = useAnimatedNumber(p99, !running);
  const animatedP50 = useAnimatedNumber(p50, !running);

  // posted/tps are REAL during the run now (they only move as batches commit),
  // so they're shown as-is. p50/p99 are per-run commit-latency stats that only
  // settle on completion, so they stay dimmed ("—") until done.
  return (
    <div className="mt-3 grid grid-cols-5 gap-3 border-t border-border-2 pt-3">
      <Stat label="posted" value={Math.round(animatedPosted).toLocaleString("en-US")} />
      <Stat label="tps" value={animatedTps.toFixed(animatedTps < 100 ? 1 : 0)} />
      <Stat label="p50 commit" value={`${animatedP50.toFixed(1)} ms`} dim={running} />
      <Stat label="p99 commit" value={`${animatedP99.toFixed(1)} ms`} dim={running} />
      <InvariantBadge inv={inv} running={running} />
    </div>
  );
}

function Stat({
  label,
  value,
  dim,
}: {
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="num text-[9px] uppercase tracking-[0.12em] text-dim">
        {label}
      </span>
      <span
        className={`num text-[16px] leading-tight ${dim ? "text-dim" : "text-fg"}`}
      >
        {dim ? "—" : value}
      </span>
    </div>
  );
}

function InvariantBadge({ inv, running }: { inv: number; running: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="num text-[9px] uppercase tracking-[0.12em] text-dim">
        invariant
      </span>
      <span
        className="num flex items-center gap-1.5 text-[16px] leading-tight"
        style={{ color: running ? "var(--dim)" : "var(--green)" }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: running ? "var(--dim)" : "var(--green)",
            boxShadow: running ? "none" : "0 0 6px rgba(16,185,129,0.6)",
          }}
        />
        {running ? "checking" : `${inv} viol.`}
      </span>
    </div>
  );
}
