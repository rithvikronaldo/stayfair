"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { useActionDialog } from "@/lib/action-dialog";
import { useApiKey } from "@/lib/api-key";
import { useCaptureFlow } from "@/lib/capture";
import { useCommandPalette } from "@/lib/command-palette";
import { DUR, EASE } from "@/lib/motion";
import { useSound } from "@/lib/sound";
import { STRESS_DEFAULT_N, useStressRun } from "@/lib/stress";
import type { UseTimeSkipApi } from "@/lib/time-skip";

type Command = {
  id: string;
  label: string;
  hint?: string; // shortcut key or short note, shown right-aligned
  // requiresAuth=true commands mutate the ledger and are hidden when the
  // user isn't signed in. The backend gates these too (401 without Bearer);
  // hiding from the palette is the UX layer that prevents anonymous
  // visitors from finding them at all.
  requiresAuth?: boolean;
  run: () => void;
};

export function CommandPalette({ timeSkip }: { timeSkip: UseTimeSkipApi }) {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const stress = useStressRun();
  const capture = useCaptureFlow();
  const openDialog = useActionDialog((s) => s.openDialog);
  const muted = useSound((s) => s.muted);
  const toggleSound = useSound((s) => s.toggle);
  const apiKey = useApiKey((s) => s.apiKey);
  const signedIn = Boolean(apiKey);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(
    () =>
      (
        [
          {
            id: "replay",
            label: "Replay the last 5 minutes",
            hint: "R",
            run: () => timeSkip.replayLast(5),
          },
          {
            id: "stress",
            label: "Stress-test · 1,000 transactions",
            hint: "S",
            requiresAuth: true,
            run: () => stress.run(STRESS_DEFAULT_N),
          },
          {
            id: "capture",
            label: "Capture the pending authorization",
            requiresAuth: true,
            run: () => void capture.capturePending(),
          },
          {
            id: "post",
            label: "Post a transaction…",
            requiresAuth: true,
            run: () => openDialog("post"),
          },
          {
            id: "spawn",
            label: "Spawn an account…",
            requiresAuth: true,
            run: () => openDialog("spawn"),
          },
          {
            id: "live",
            label: "Back to LIVE (snap to now)",
            run: () => timeSkip.snapToNow(),
          },
          {
            id: "sound",
            label: muted ? "Unmute sound" : "Mute sound",
            run: () => toggleSound(),
          },
        ] as Command[]
      ).filter((c) => signedIn || !c.requiresAuth),
    [timeSkip, stress, capture, openDialog, muted, toggleSound, signedIn],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset query + selection each time the palette opens, and focus the input.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // Focus on the next frame so the element is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the selection in range as the filter narrows.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function runAt(index: number) {
    const cmd = filtered[index];
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (filtered.length ? (s + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) =>
        filtered.length ? (s - 1 + filtered.length) % filtered.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(selected);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="cmdk-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.ui, ease: EASE.outQuart }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-[12vh] backdrop-blur-sm"
        >
          <motion.div
            key="cmdk-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
            onClick={(e) => e.stopPropagation()}
            className="w-[520px] max-w-full overflow-hidden rounded-md border border-border bg-surface-1 shadow-2xl"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a command…"
              aria-label="Command palette"
              className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-dim"
            />
            <ul className="max-h-[320px] overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-4 py-3 text-xs text-dim">No matching commands.</li>
              ) : (
                filtered.map((cmd, i) => (
                  <li key={cmd.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => runAt(i)}
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                        i === selected
                          ? "bg-surface-2 text-fg"
                          : "text-muted hover:bg-surface-2/50"
                      }`}
                    >
                      <span>{cmd.label}</span>
                      {cmd.hint && (
                        <kbd className="num ml-3 rounded-sm border border-border-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-dim">
                          {cmd.hint}
                        </kbd>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex items-center justify-between border-t border-border-2 px-4 py-2 text-[10px] text-dim">
              <span className="num uppercase tracking-wider">↑↓ navigate · ↵ run · esc close</span>
              <span className="num uppercase tracking-wider">⌘K</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
