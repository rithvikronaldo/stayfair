"use client";

import { useEffect, useState } from "react";

import { SignupDialog } from "@/components/signup-dialog";
import { api, ApiError } from "@/lib/api";
import { useApiKey, hydrateApiKey } from "@/lib/api-key";

// Per-key collapse flag — once the user collapses the curl card for a
// given API key, it stays collapsed across reloads as a small chip in
// the corner. New signups (different key) get the full card again.
const DISMISS_KEY_PREFIX = "stayfair.curl_card_dismissed.";

function isDismissed(apiKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + apiKey) === "1";
  } catch {
    return false;
  }
}

function setDismissed(apiKey: string, dismissed: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) localStorage.setItem(DISMISS_KEY_PREFIX + apiKey, "1");
    else localStorage.removeItem(DISMISS_KEY_PREFIX + apiKey);
  } catch {
    // ignore
  }
}

export function LandingStrip() {
  const apiKey = useApiKey((s) => s.apiKey);
  const email = useApiKey((s) => s.email);
  const clear = useApiKey((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [cardHidden, setCardHidden] = useState(false);

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

  // Re-check the dismiss flag whenever the key changes (sign-in, sign-out,
  // switch). Fresh signups always see the card.
  useEffect(() => {
    if (apiKey) setCardHidden(isDismissed(apiKey));
    else setCardHidden(false);
  }, [apiKey]);

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
              : "Multi-currency, double-entry, point-in-time-queryable. Below is the public demo tenant — get your own with a curl."}
          </span>
        </div>

        {signedIn ? (
          <button
            type="button"
            onClick={clear}
            className="num shrink-0 border border-border px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-muted hover:text-fg"
          >
            Sign out
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="num shrink-0 border border-accent bg-accent px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-bg hover:opacity-90"
          >
            Sign up for an API key →
          </button>
        )}
      </div>

      {signedIn && apiKey && (
        cardHidden ? (
          <CurlChip
            onExpand={() => {
              setDismissed(apiKey, false);
              setCardHidden(false);
            }}
          />
        ) : (
          <CurlCard
            apiKey={apiKey}
            onDismiss={() => {
              setDismissed(apiKey, true);
              setCardHidden(true);
            }}
          />
        )
      )}

      <SignupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function CurlCard({
  apiKey,
  onDismiss,
}: {
  apiKey: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Self-mode tenants start with zero accounts (the migration only
  // backfilled demo's existing rows). The first useful curl is therefore
  // an account spawn — it lands a new row visible in the agents pane via
  // the 5s polling loop. Posting a transaction would 404 against the
  // user's empty account list.
  const curl = `curl -X POST http://localhost:8080/agents \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "first-account", "currency": "USD"}'`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — user can select+copy
    }
  }

  return (
    <div className="fixed right-4 top-12 z-30 w-[520px] border border-border bg-surface-1 p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="num text-[10px] uppercase tracking-[0.14em] text-accent">
          create your first account
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="num border border-accent bg-accent px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-bg"
          >
            {copied ? "copied" : "copy curl"}
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="flex h-6 w-6 items-center justify-center border border-border text-[14px] leading-none text-muted hover:text-fg"
          >
            ×
          </button>
        </div>
      </div>
      <pre className="num overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-fg">
        {curl}
      </pre>
    </div>
  );
}

function CurlChip({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label="Show curl"
      className="num fixed right-4 top-12 z-30 flex items-center gap-2 border border-border bg-surface-1 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-accent shadow-lg hover:border-accent"
    >
      <span>curl</span>
      <span className="text-muted">↓</span>
    </button>
  );
}
