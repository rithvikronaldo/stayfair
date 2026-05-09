"use client";

export function ScrubberShell() {
  return (
    <div className="flex h-20 items-center gap-4 border-t border-border bg-bg px-8">
      <div className="flex h-8">
        <button className="num flex h-8 w-8 items-center justify-center border border-border text-[11px] text-muted hover:text-fg">
          ◀
        </button>
        <button className="num flex h-8 w-8 items-center justify-center border border-l-0 border-border text-[11px] text-muted hover:text-fg">
          ▶
        </button>
      </div>

      <div className="relative flex-1 h-20">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />

        <div
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 mix-blend-difference"
          style={{
            width: "100%",
            background:
              "linear-gradient(90deg, rgba(34,211,238,0.05), rgba(34,211,238,1))",
          }}
        />

        {[0, 25, 33, 50, 58, 75, 83, 100].map((p, i) => (
          <div
            key={i}
            className={`absolute top-1/2 -translate-y-1/2 ${
              [33, 58, 83].includes(p) ? "h-2 w-px bg-accent" : "h-1 w-px bg-border"
            }`}
            style={{ left: `${p}%` }}
          />
        ))}

        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 mix-blend-difference"
          style={{
            left: "99.4%",
            width: 14,
            height: 14,
            borderRadius: 999,
            border: "1px solid var(--neon)",
            opacity: 0.35,
          }}
        />

        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 mix-blend-difference"
          style={{
            left: "100%",
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "var(--bg)",
            border: "1.5px solid var(--neon)",
            boxShadow:
              "0 0 12px rgba(34,211,238,0.6), 0 0 0 4px rgba(10,10,11,0.8)",
          }}
        />

        <div className="num pointer-events-none absolute bottom-2 left-0 right-0 flex justify-between text-[10px] tracking-[0.12em] text-dim">
          <span>−24h</span>
          <span>−18h</span>
          <span>−12h</span>
          <span>−06h</span>
          <span className="text-accent">NOW</span>
        </div>
      </div>

      <div className="num flex flex-col items-end">
        <span className="text-[13px] tracking-[0.06em] text-accent">
          LIVE · 1.0×
        </span>
        <span className="text-[10px] tracking-[0.1em] text-dim">
          tick · 214 ms · lag 12 ms
        </span>
      </div>
    </div>
  );
}
