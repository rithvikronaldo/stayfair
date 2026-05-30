"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { SignupDialog } from "@/components/signup-dialog";
import { api, ApiError } from "@/lib/api";
import { useApiKey, hydrateApiKey } from "@/lib/api-key";

// The dashboard is tuned for desktop ≥ 1440px (fixed 3-column grid, big
// hero number, tx stream that needs ~360px). Below 1280px it gets visibly
// cramped but still loads and works. Per the W6 launch plan, mobile-native
// is post-launch — we ship desktop-only with a one-line notice that sets
// expectations for narrow-screen visitors instead of blocking them.
const NARROW_BREAKPOINT_PX = 1280;

export function LandingStrip() {
  const apiKey = useApiKey((s) => s.apiKey);
  const email = useApiKey((s) => s.email);
  const clear = useApiKey((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    hydrateApiKey();
    setMounted(true);
    if (useApiKey.getState().apiKey) {
      api.getMe().catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          useApiKey.getState().clear();
        }
      });
    }
  }, []);

  // Watch viewport width. matchMedia is the right primitive here — fires
  // once on subscribe and again on every cross-threshold resize. Runs only
  // after mount so SSR + first client render match.
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX}px)`);
    setIsNarrow(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Until mounted, render the "not signed in" state — matches SSR exactly so
  // hydration doesn't trip on a key found in localStorage.
  const signedIn = mounted && apiKey !== null;

  return (
    <>
      <div className="flex h-9 items-center justify-between border-b border-border bg-surface-1 px-4">
        <div className="flex items-baseline gap-2 truncate">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg">
            Ledger sandbox
          </span>
          <span className="text-[11px] text-dim">·</span>
          <span className="truncate text-[12px] text-muted">
            {signedIn
              ? `Signed in as ${email || "you"} — your tenant view, polled every 5s.`
              : "Multi-currency, double-entry, point-in-time-queryable. Below is the public demo tenant — get your own in one click."}
          </span>
          {mounted && isNarrow && (
            <>
              <span className="text-[11px] text-dim">·</span>
              <span
                className="truncate text-[11px] text-accent"
                title="The dashboard's 3-column grid is tuned for ≥ 1440px wide displays. It still works at narrower widths but the layout reads cramped — open on a wider screen (or zoom out to ~80%) for the intended view."
              >
                Best viewed on desktop ≥ 1440px wide
              </span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/docs"
            className="num text-[11px] uppercase tracking-[0.14em] text-muted hover:text-fg"
          >
            Docs
          </Link>
          {signedIn ? (
            <button
              type="button"
              onClick={clear}
              className="num border border-border px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-muted hover:text-fg"
            >
              Sign out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="num border border-accent bg-accent px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-bg hover:opacity-90"
            >
              Sign up for an API key →
            </button>
          )}
        </div>
      </div>

      <SignupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
