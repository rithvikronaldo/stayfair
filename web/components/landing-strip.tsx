"use client";

export function LandingStrip() {
  return (
    <div className="flex h-9 items-center justify-between border-b border-border bg-surface-1 px-4">
      <div className="flex items-baseline gap-2 truncate">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg">
          Ledger sandbox
        </span>
        <span className="text-[11px] text-dim">·</span>
        <span className="truncate text-[12px] text-muted">
          Multi-currency, double-entry, point-in-time-queryable. Below is the
          public demo tenant — get your own with a curl.
        </span>
      </div>
      <button
        type="button"
        disabled
        title="Signup ships next week"
        className="num shrink-0 border border-border px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-dim opacity-60"
      >
        Sign up for an API key →
      </button>
    </div>
  );
}
