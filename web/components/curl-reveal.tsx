"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { API_URL } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { DUR, EASE } from "@/lib/motion";

// CurlReveal is the guided flow's step 4 — the teaching layer. It shows the
// curl equivalents of the three actions the user just clicked through, so the
// in-app buttons never hide the real API. Never the only path to anything;
// purely "here's what that button did over the wire."

type Snippet = {
  label: string;
  body: string;
};

function snippets(apiKey: string): Snippet[] {
  const auth = `-H "Authorization: Bearer ${apiKey}"`;
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  return [
    {
      label: "1 · capture the pending auth (The Catch)",
      body: `# find the pending hold, then settle it in full
curl ${API_URL}/authorizations?status=pending \\
  ${auth}

curl -X POST ${API_URL}/authorizations/<auth_id>/capture \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -d '{"amount": <amount>}'`,
    },
    {
      label: "2 · stress-test (the Take-Off)",
      body: `curl -X POST ${API_URL}/stress \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -d '{"n": 1000}'`,
    },
    {
      label: "3 · replay the last 5 minutes",
      body: `# replay is built from the raw entries — query them at any window
curl "${API_URL}/transactions?from=${fiveMinAgo}" \\
  ${auth}`,
    },
  ];
}

export function CurlReveal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const apiKey = useApiKey((s) => s.apiKey);
  const list = snippets(apiKey ?? "<your_api_key>");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="curl-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.ui, ease: EASE.outQuart }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
        >
          <motion.div
            key="curl-panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
            onClick={(e) => e.stopPropagation()}
            className="w-[640px] max-w-full rounded-md border border-border bg-surface-1 p-4 shadow-2xl"
          >
            <header className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="num text-[11px] uppercase tracking-[0.14em] text-accent">
                  See the API
                </h2>
                <p className="mt-1 text-xs text-muted">
                  The curl behind each button you clicked. The dashboard is just
                  a client — every action is a plain HTTP call.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="flex h-6 w-6 shrink-0 items-center justify-center border border-border text-[14px] leading-none text-muted hover:text-fg"
              >
                ×
              </button>
            </header>

            <div className="space-y-3">
              {list.map((s) => (
                <CurlBlock key={s.label} label={s.label} body={s.body} />
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CurlBlock({ label, body }: Snippet) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      toast.success("curl copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("clipboard unavailable — select and copy manually");
    }
  }

  return (
    <div className="rounded-sm border border-border-2 bg-surface-2/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="num text-[10px] uppercase tracking-[0.14em] text-dim">
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="num shrink-0 border border-accent bg-accent px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-bg hover:opacity-90"
        >
          {copied ? "copied" : "copy curl"}
        </button>
      </div>
      <pre className="num overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-fg">
        {body}
      </pre>
    </div>
  );
}
