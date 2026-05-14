"use client";

import { useEffect, useState } from "react";

import { SignupDialog } from "@/components/signup-dialog";
import { useApiKey, hydrateApiKey } from "@/lib/api-key";

export function LandingStrip() {
  const apiKey = useApiKey((s) => s.apiKey);
  const email = useApiKey((s) => s.email);
  const clear = useApiKey((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    hydrateApiKey();
    setMounted(true);
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
              ? `Signed in as ${email || "you"} — your dashboard view ships next week. Use the API now:`
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

      {signedIn && apiKey && <CurlCard apiKey={apiKey} />}

      <SignupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function CurlCard({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);
  const now = new Date().toISOString();
  const curl = `curl -X POST http://localhost:8080/transactions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "first tx",
    "occurred_at": "${now}",
    "entries": [
      {"account": "cash",           "amount": 100, "currency": "INR", "direction": "in"},
      {"account": "guest_payments", "amount": 100, "currency": "INR", "direction": "out"}
    ]
  }'`;

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
      <div className="mb-2 flex items-center justify-between">
        <span className="num text-[10px] uppercase tracking-[0.14em] text-accent">
          your first transaction
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="num border border-accent bg-accent px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-bg"
        >
          {copied ? "copied" : "copy curl"}
        </button>
      </div>
      <pre className="num overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-fg">
        {curl}
      </pre>
    </div>
  );
}
