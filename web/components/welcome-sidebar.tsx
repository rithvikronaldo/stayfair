"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { useApiKey } from "@/lib/api-key";
import { DUR, EASE } from "@/lib/motion";

// Welcome sidebar shell — W5 D3.
// Buttons are intentionally inert; wiring lands W6 D1 (per project_launch_plan).
// Visible only when a user is signed in (apiKey present) and hasn't dismissed
// the tour. Two states: open (full panel) and minimized (corner chip).

type Step = {
  num: number;
  title: string;
  blurb: string;
};

const STEPS: Step[] = [
  {
    num: 1,
    title: "Capture the pending auth",
    blurb:
      "Move the held amount from on-hold to cleared. The Catch animation plays.",
  },
  {
    num: 2,
    title: "Stress-test · 1,000 txs in 10 sec",
    blurb:
      "Watch p99 commit latency and invariant violations live as the chart takes off.",
  },
  {
    num: 3,
    title: "Replay the last 5 minutes",
    blurb:
      "Rewind your own ledger. Balances count back; event stream unwinds.",
  },
  {
    num: 4,
    title: "See the API · optional",
    blurb:
      "Curl commands for what you just clicked. For the backend-curious only.",
  },
];

const STORAGE_KEY = "acta_welcome";
type State = "open" | "minimized" | "dismissed";

function readState(): State {
  if (typeof window === "undefined") return "open";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "minimized" || v === "dismissed") return v;
  return "open";
}

function writeState(s: State) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, s);
}

export function WelcomeSidebar() {
  const apiKey = useApiKey((s) => s.apiKey);
  const [state, setState] = useState<State>("open");
  const [hydrated, setHydrated] = useState(false);

  // Read localStorage after mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    setState(readState());
    setHydrated(true);
  }, []);

  if (!apiKey || !hydrated || state === "dismissed") return null;

  const minimize = () => {
    setState("minimized");
    writeState("minimized");
  };
  const dismiss = () => {
    setState("dismissed");
    writeState("dismissed");
  };
  const expand = () => {
    setState("open");
    writeState("open");
  };

  return (
    <AnimatePresence mode="wait">
      {state === "open" ? (
        <motion.aside
          key="open"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
          className="fixed right-6 top-24 z-30 w-[340px] rounded-md border border-border bg-surface-1/95 p-4 shadow-xl backdrop-blur"
        >
          <header className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-fg">
                Welcome to your ledger
              </h2>
              <p className="mt-1 text-xs text-muted">
                Try these — each is a real action on your data.
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label="Minimize tour"
                onClick={minimize}
                className="px-1 text-sm text-muted hover:text-fg"
              >
                −
              </button>
              <button
                type="button"
                aria-label="Dismiss tour"
                onClick={dismiss}
                className="px-1 text-sm text-muted hover:text-fg"
              >
                ×
              </button>
            </div>
          </header>

          <ol className="space-y-2">
            {STEPS.map((step) => (
              <li key={step.num}>
                <button
                  type="button"
                  className="group w-full rounded-sm border border-border-2 bg-surface-2/40 px-3 py-2 text-left transition-colors hover:border-border hover:bg-surface-2"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-dim">
                      {String(step.num).padStart(2, "0")}
                    </span>
                    <span className="text-sm font-medium text-fg">
                      ▶ {step.title}
                    </span>
                  </div>
                  <p className="mt-1 pl-6 text-xs leading-snug text-muted">
                    {step.blurb}
                  </p>
                </button>
              </li>
            ))}
          </ol>

          <footer className="mt-3 flex justify-between border-t border-border-2 pt-3 text-xs text-muted">
            <button
              type="button"
              onClick={minimize}
              className="hover:text-fg"
            >
              Skip the tour
            </button>
            <span className="font-mono text-[10px] uppercase tracking-wider text-dim">
              4 steps · ~3 min
            </span>
          </footer>
        </motion.aside>
      ) : (
        <motion.button
          key="chip"
          type="button"
          onClick={expand}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: DUR.ui, ease: EASE.outQuart }}
          className="fixed bottom-24 right-6 z-30 rounded-full border border-border bg-surface-1 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-fg shadow-lg hover:bg-surface-2"
        >
          ▶ Tour
        </motion.button>
      )}
    </AnimatePresence>
  );
}
