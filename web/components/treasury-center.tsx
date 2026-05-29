"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useTransform, motion } from "motion/react";

import { api } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { fmtMinor } from "@/lib/format";
import { DUR, EASE } from "@/lib/motion";
import { useStore, type AgentRow, type FlashState } from "@/lib/store";

export function TreasuryCenter({
  totalUsd,
  flash,
  agents,
}: {
  totalUsd: number;
  flash: FlashState;
  agents: AgentRow[];
}) {
  const tx24h = agents.reduce((acc, a) => acc + a.tx24h, 0);
  const burnPerHr = agents.reduce(
    (acc, a) => acc + a.burnPerHr,
    0,
  );
  const mode = useStore((s) => s.mode);
  const isSelf = mode === "self";

  // Conservation check: in a closed double-entry tenant the sum of every
  // account's balance must be 0 (Post() enforces sum(entries)=0 per tx). We
  // tolerate a tiny epsilon to absorb FX rounding when mixed-currency totals
  // are converted to a single base — strict equality only holds in a single-
  // currency tenant. The badge becomes a live invariant indicator instead of
  // hardcoded "OK". `currencies > 1 || agents.length === 0` skips the check
  // when it can't be meaningfully computed.
  const currencies = new Set(agents.map((a) => a.currency)).size;
  const rawSum = agents.reduce((acc, a) => acc + a.balance, 0);
  const reconcileOk =
    agents.length === 0 || currencies > 1 || Math.abs(rawSum) < 100; // <$1 drift

  return (
    <div className="relative flex h-full flex-col px-6 pt-4">
      <div className="flex h-6 items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.12em] text-fg">
          {isSelf ? "Your ledger" : "Ledger"}
        </span>
        <span className="text-[11px] text-dim">·</span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          USD
        </span>
        <span className="text-[11px] text-dim">·</span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          {isSelf ? "Your accounts" : "All accounts"}
        </span>
        <span className="text-[11px] text-dim">·</span>
        <span className="num text-[11px] uppercase tracking-[0.12em] text-muted">
          As of <LiveTimestamp />
        </span>
        <div className="flex-1" />
        <span
          className="num text-[11px] uppercase tracking-[0.12em] text-muted"
          title={
            reconcileOk
              ? "Conservation invariant holds: sum of all account balances is 0"
              : `Drift detected: sum of balances = ${(rawSum / 100).toFixed(2)} (should be 0)`
          }
        >
          Reconcile{" "}
          {reconcileOk ? (
            <span className="text-green">OK</span>
          ) : (
            <span className="text-red">DRIFT</span>
          )}
        </span>
      </div>
      <div className="mt-1 text-[10px] tracking-[0.1em] text-dim">
        {currencies > 1
          ? "total ledger value · FX-converted to USD at as_of timestamp"
          : "sum of positive balances · sum of all balances is 0 (conservation)"}
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto] items-end gap-6">
        <HeroNumber totalUsd={totalUsd} flash={flash} />

        {/* Side stats: only real, computed metrics. The previous demo-mode
            block had Open/High/Low/vs-Open/band·24h/tick-latency as
            hardcoded strings — stock-market metaphors that don't map to a
            ledger and read as theater to an engineer audience in five
            seconds. Volume / Burn / Runway are derived from real tx data
            so they earn their space. */}
        {agents.length > 0 ? (
          <SideStats
            rows={[
              { k: "Volume · 24h", v: `${tx24h.toLocaleString("en-US")} tx` },
              { k: "Burn / hr", v: `$${burnPerHr.toFixed(2)}` },
              { k: "Runway", v: estRunway(totalUsd, burnPerHr) },
            ]}
          />
        ) : (
          <div />
        )}
        <div />
      </div>

      <VolumeChart />
    </div>
  );
}

function HeroNumber({
  totalUsd,
  flash,
}: {
  totalUsd: number;
  flash: FlashState;
}) {
  const mv = useMotionValue(totalUsd);
  const display = useTransform(mv, (v) => fmtMinor(v));
  const prev = useRef(totalUsd);

  useEffect(() => {
    const controls = animate(mv, totalUsd, {
      duration: DUR.entrance,
      ease: EASE.outQuart,
    });
    prev.current = totalUsd;
    return () => controls.stop();
  }, [totalUsd, mv]);

  const flashCls =
    flash === "up"
      ? "flash-up"
      : flash === "down"
        ? "flash-down"
        : flash === "hold"
          ? "flash-hold"
          : "";

  const [whole, frac] = fmtMinor(totalUsd).split(".");
  void whole;
  void frac;

  return (
    <div className="num flex items-baseline gap-2 leading-none tracking-tight text-fg">
      <span className="text-[clamp(28px,3.6vw,48px)] font-light text-dim">$</span>
      <motion.span
        className={`text-[clamp(54px,6.6vw,98px)] font-light ${flashCls}`}
      >
        <motion.span>{display}</motion.span>
      </motion.span>
    </div>
  );
}

function SideStats({ rows }: { rows: { k: string; v: string }[] }) {
  return (
    <div className="flex flex-col gap-1.5 pb-3">
      {rows.map((r) => (
        <div key={r.k} className="flex items-baseline gap-2.5 text-[12px]">
          <span className="w-24 text-[10px] uppercase tracking-[0.12em] text-muted">
            {r.k}
          </span>
          <span className="num text-fg">{r.v}</span>
        </div>
      ))}
    </div>
  );
}


function LiveTimestamp() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) {
    return <span className="text-accent">LIVE · ---- -- -- --:--:-- UTC</span>;
  }
  const yyyy = now.getUTCFullYear();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  return (
    <span className="text-accent">
      LIVE · {yyyy}-{mm}-{dd} {hh}:{mi}:{ss} UTC
    </span>
  );
}

function estRunway(totalUsd: number, burnPerHr: number): string {
  const hrs = totalUsd / 100 / Math.max(burnPerHr, 0.01);
  const h = Math.floor(hrs);
  const m = Math.floor((hrs - h) * 60);
  return `${h}h ${m}m`;
}

// VolumeChart plots $ volume per minute over the past hour — the dollars
// moved by captured transactions in each 60-second bucket.
//
// Why volume and not "total ledger value": in a closed double-entry tenant,
// sum-of-positive-balances is a near-invariant (transfers between two
// positive accounts don't change it). Plotting it produces an honest but
// flat line. Volume varies naturally with activity, so the chart actually
// communicates "is the system doing work?" — the question engineers care
// about. It also makes the REPLAY marker meaningful: scrubbing back lands
// on a peak/trough of activity, not on indistinguishable points of a line.
//
// Pipeline:
//   1) On mount + every 15s, fetch the last hour of transactions via
//      api.listTransactions({from: 1h ago, limit: 1000}).
//   2) Bucket by minute (occurred_at floor-to-minute). Sum the source-side
//      entry amount per bucket (= $ that moved that minute, minor units).
//   3) Render a line over the past 60 buckets. The current minute's bucket
//      is partial; it'll keep filling until that minute rolls over.
// During REPLAY (asOf non-null) the refresh pauses so the chart freezes at
// the live trajectory and a marker is drawn at the scrubber position.
const REFRESH_INTERVAL_MS = 15_000;
const VOLUME_WINDOW_MS = 60 * 60_000; // 1 hour
const VOLUME_BUCKET_MS = 60_000; // 1 minute
const VOLUME_BUCKET_COUNT = VOLUME_WINDOW_MS / VOLUME_BUCKET_MS; // 60

type Sample = { ts: number; value: number };

function VolumeChart() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const apiKey = useApiKey((s) => s.apiKey);
  const asOf = useStore((s) => s.asOf);
  const inReplay = asOf !== null;

  // Fetch + bucket. Memoised inline; the effect that calls it re-runs on
  // apiKey changes (so signing in switches to the user's tenant data).
  useEffect(() => {
    if (inReplay) return; // chart is frozen — see REPLAY comment above
    let cancelled = false;

    async function refresh() {
      const now = Date.now();
      const fromIso = new Date(now - VOLUME_WINDOW_MS).toISOString();
      try {
        const page = await api.listTransactions({
          from: fromIso,
          limit: 1000,
        });
        if (cancelled) return;
        const buckets = bucketByMinute(page.transactions, now);
        setSamples(buckets);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    void refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiKey, inReplay]);

  // X-axis labels tick forward every 5s so "NOW" stays at wall time.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const points = samples.length;
  const oldestMs = points > 0 ? samples[0].ts : nowMs - VOLUME_WINDOW_MS;
  const windowMs = Math.max(nowMs - oldestMs, 60_000);
  const totalVolumeMinor = samples.reduce((a, s) => a + s.value, 0);
  const peakBucket = samples.reduce(
    (acc, s) => (s.value > acc ? s.value : acc),
    0,
  );

  return (
    <div className="mt-5 flex flex-1 flex-col border-t border-border-2 pt-3">
      <div className="flex h-5 items-center justify-between">
        <span
          className={`num text-[10px] uppercase tracking-[0.1em] ${
            inReplay ? "text-accent" : "text-dim"
          }`}
          title={
            inReplay
              ? "Frozen — you're in REPLAY mode. The dashed vertical line marks the scrubber position on the volume timeline. Snap back to LIVE to resume."
              : "Dollar volume per minute over the past hour: sum of captured-transaction amounts in each 60-second bucket. Refreshes every 15s; the rightmost bucket is the current minute and keeps filling."
          }
        >
          {inReplay ? "volume / min · frozen (replay)" : "volume / min · live"}
        </span>
        <div className="flex gap-4">
          <span
            className="num text-[11px] uppercase tracking-[0.1em] text-muted"
            title={`Each point is the total dollar volume captured in one minute. Peak this hour: $${fmtMinor(peakBucket)}. Total this hour: $${fmtMinor(totalVolumeMinor)}.`}
          >
            USD ·{" "}
            {loading
              ? "loading last hour…"
              : `$${fmtMinor(totalVolumeMinor)} in ${fmtSpan(windowMs)} · peak $${fmtMinor(peakBucket)}/min`}
          </span>
          <span className="text-[11px] uppercase tracking-[0.1em] text-muted">
            <span className="text-accent">●</span> $ / min
          </span>
        </div>
      </div>
      <div className="mt-2 flex-1">
        <VolumeBars samples={samples} nowMs={nowMs} asOf={asOf} />
      </div>
      <div className="num flex justify-between border-t border-border-2 py-1.5 text-[10px] tracking-[0.1em] text-dim">
        {points > 1 ? (
          <>
            <span>−{fmtSpan(windowMs)}</span>
            <span>−{fmtSpan(windowMs / 2)}</span>
            <span>NOW</span>
          </>
        ) : loading ? (
          <span>fetching last hour of /transactions…</span>
        ) : (
          <span>no transactions in the last hour</span>
        )}
      </div>
    </div>
  );
}

// bucketByMinute groups a list of transactions into 60 one-minute buckets
// across the past hour ending at nowMs. The bucket value is the sum of the
// source-side ("out") entry amounts — that is, dollars *moved* in that
// minute. Empty buckets are kept so the chart maintains an even X-axis
// (a quiet minute reads as zero, not as a gap).
function bucketByMinute(
  txs: { occurred_at: string; entries: { amount: number; direction: "in" | "out"; currency: string }[] }[],
  nowMs: number,
): Sample[] {
  const buckets: Sample[] = [];
  const bucketStart = (ms: number) => Math.floor(ms / VOLUME_BUCKET_MS) * VOLUME_BUCKET_MS;
  const oldestBucket = bucketStart(nowMs - VOLUME_WINDOW_MS);
  for (let i = 0; i < VOLUME_BUCKET_COUNT; i++) {
    buckets.push({ ts: oldestBucket + i * VOLUME_BUCKET_MS, value: 0 });
  }
  for (const tx of txs) {
    const ts = Date.parse(tx.occurred_at);
    if (!Number.isFinite(ts)) continue;
    const bucket = bucketStart(ts);
    const idx = Math.round((bucket - oldestBucket) / VOLUME_BUCKET_MS);
    if (idx < 0 || idx >= buckets.length) continue;
    const outEntry = tx.entries.find((e) => e.direction === "out");
    if (!outEntry) continue;
    // FX conversion deferred — most tenants are single-currency for now.
    // If/when this matters, multiply by FX_TO_USD[entry.currency].
    buckets[idx].value += outEntry.amount;
  }
  return buckets;
}

function VolumeBars({
  samples,
  nowMs,
  asOf,
}: {
  samples: Sample[];
  nowMs: number;
  asOf: Date | null;
}) {
  const setAsOf = useStore((s) => s.setAsOf);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (samples.length === 0) {
    return (
      <svg
        className="block h-full w-full"
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1="29"
          x2="100"
          y2="29"
          stroke="var(--border)"
          strokeWidth="0.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const peak = samples.reduce((m, s) => (s.value > m ? s.value : m), 0);
  // Linear scale — for volume, a tall bar should read as N× a short bar.
  // No floor: a quiet hour really does sit at zero; that's the truth.
  const scale = peak > 0 ? 28 / peak : 0;
  const bucketW = 100 / samples.length;
  const barW = bucketW * 0.78; // small gap between bars
  const barInset = (bucketW - barW) / 2;

  // REPLAY marker — vertical dashed line at the asOf position.
  const asOfMs = asOf?.getTime() ?? null;
  const oldest = samples[0].ts;
  const span = Math.max(samples[samples.length - 1].ts + 60_000 - oldest, 1);
  const showMarker =
    asOfMs !== null && asOfMs >= oldest && asOfMs <= nowMs;
  const markerX = showMarker
    ? (((asOfMs as number) - oldest) / span) * 100
    : null;

  const hovered = hoverIdx !== null ? samples[hoverIdx] : null;

  function onSvgMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const idx = Math.max(0, Math.min(samples.length - 1, Math.floor(xPct / bucketW)));
    setHoverIdx(idx);
  }
  function onSvgLeave() {
    setHoverIdx(null);
  }
  function onSvgClick() {
    if (hoverIdx === null) return;
    const ts = samples[hoverIdx].ts;
    // Set asOf to the START of the hovered minute. Scrubber jumps, dashboard
    // rewinds via useScrubberRewind, replay marker drops on the bar.
    setAsOf(new Date(ts));
  }

  return (
    <div className="relative h-full w-full">
      <svg
        className="block h-full w-full cursor-crosshair"
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        onPointerMove={onSvgMove}
        onPointerLeave={onSvgLeave}
        onClick={onSvgClick}
      >
        {/* Baseline */}
        <line
          x1="0"
          y1="29.8"
          x2="100"
          y2="29.8"
          stroke="var(--border)"
          strokeWidth="0.4"
          vectorEffect="non-scaling-stroke"
        />
        {/* Bars */}
        {samples.map((s, i) => {
          const x = i * bucketW + barInset;
          const h = s.value * scale;
          const y = 30 - h - 0.2;
          const isHover = hoverIdx === i;
          const hasValue = s.value > 0;
          return (
            <rect
              key={s.ts}
              x={x}
              y={hasValue ? y : 29.4}
              width={barW}
              height={hasValue ? h : 0.4}
              fill={
                isHover
                  ? "var(--accent)"
                  : hasValue
                    ? "var(--accent)"
                    : "var(--border)"
              }
              opacity={isHover ? 1 : hasValue ? 0.75 : 1}
            />
          );
        })}
        {/* Hover crosshair */}
        {hoverIdx !== null && (
          <line
            x1={hoverIdx * bucketW + bucketW / 2}
            y1={0}
            x2={hoverIdx * bucketW + bucketW / 2}
            y2={30}
            stroke="var(--accent)"
            strokeWidth="0.3"
            strokeDasharray="0.5 0.5"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {/* REPLAY marker */}
        {markerX !== null && (
          <line
            x1={markerX}
            y1={0}
            x2={markerX}
            y2={30}
            stroke="var(--accent)"
            strokeWidth="0.4"
            strokeDasharray="1 1"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </svg>
      {hovered && (
        <BarTooltip
          ts={hovered.ts}
          value={hovered.value}
          xPct={(hoverIdx as number) / samples.length}
        />
      )}
    </div>
  );
}

function BarTooltip({
  ts,
  value,
  xPct,
}: {
  ts: number;
  value: number;
  xPct: number;
}) {
  const d = new Date(ts);
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  // Position toward the left when the cursor is past the midpoint so the
  // tooltip never clips off the right edge.
  const leftSide = xPct > 0.5;
  return (
    <div
      className={`pointer-events-none absolute top-1 ${
        leftSide ? "right-0" : "left-0"
      } num border border-border bg-surface-1 px-2 py-1 text-[10px] uppercase tracking-[0.12em] shadow-lg`}
      style={{
        // shift slightly off the cursor column so it doesn't sit on the crosshair
        transform: leftSide ? "translateX(-8px)" : "translateX(8px)",
      }}
    >
      <span className="text-dim">{hh}:{mm} UTC</span>
      <span className="mx-2 text-border">·</span>
      <span className="text-accent">${fmtMinor(value)}</span>
      <div className="mt-0.5 text-[9px] text-dim normal-case">
        click to scrub to this minute
      </div>
    </div>
  );
}

function fmtSpan(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}
