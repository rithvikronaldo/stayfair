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
const H = 420;
const CHART_W = 560;
const CHART_H = 220;
const PAD_LEFT = 56;
const PAD_TOP = 24;

const ESTIMATED_TPS = 500;

export function TakeOffChart() {
  const stress = useStressRun();
  const phase = useStore((s) => s.stressPhase);
  const n = useStore((s) => s.stressN);
  const startedAt = useStore((s) => s.stressStartedAt);
  const result = useStore((s) => s.stressResult);

  // tick drives the running-phase animation. We update via rAF so the line
  // grows visibly during the synchronous POST. Stops once phase != running.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (phase !== "running") return;
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
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

  const elapsedMs = isDone
    ? result.elapsed_ms
    : Math.max(1, Date.now() - (startedAt || Date.now()));
  const elapsedSec = elapsedMs / 1000;

  const projectedPosted = isDone
    ? result.n_posted
    : Math.min(n, Math.floor((elapsedMs / 1000) * ESTIMATED_TPS));

  // Axis scales — both autoscale as the run progresses so the line stays
  // visually rising rather than running into the right edge or topping out.
  const xMax = Math.max(elapsedSec, 1.5);
  const yMax = Math.max(projectedPosted, Math.min(n, 100));

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

  // Two-point line: origin → current. The visual "takeoff" is the slope
  // change between the LIVE baseline (assumed flat) and this rising line.
  const linePoints = [
    { x: 0, y: 0 },
    { x: elapsedSec, y: projectedPosted },
  ];

  const tps = isDone ? result.tps_peak : projectedPosted / Math.max(0.1, elapsedSec);

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
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm pointer-events-none"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
            className="fixed left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 border border-accent bg-surface-1/95 shadow-[0_8px_48px_rgba(245,158,11,0.18)] backdrop-blur"
            style={{ width: W, height: H }}
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
                    n = {n.toLocaleString()}{isDone && result.currency ? ` · ${result.currency}` : ""}
                    {isDone && result.serialization_retries > 0
                      ? ` · ${result.serialization_retries.toLocaleString()} retries`
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
                    {/* Endpoint dot at the latest sample */}
                    <circle
                      cx={xScale(elapsedSec)}
                      cy={yScale(projectedPosted)}
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
                posted={projectedPosted}
                tps={tps}
                p99={isDone ? result.p99_commit_ms : 0}
                p50={isDone ? result.p50_commit_ms : 0}
                inv={isDone ? result.invariant_violations : 0}
                running={!isDone}
              />

              <div className="mt-auto flex items-center gap-2 pt-4">
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
                  {tick > 0 || isDone ? `${elapsedSec.toFixed(2)}s` : ""}
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
  const animatedPosted = useAnimatedNumber(posted);
  const animatedTps = useAnimatedNumber(tps);
  const animatedP99 = useAnimatedNumber(p99);
  const animatedP50 = useAnimatedNumber(p50);

  return (
    <div className="mt-3 grid grid-cols-5 gap-3 border-t border-border-2 pt-3">
      <Stat label="posted" value={Math.round(animatedPosted).toLocaleString()} />
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
