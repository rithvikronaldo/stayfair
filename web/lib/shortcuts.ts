"use client";

import { useEffect } from "react";

import { useCommandPalette } from "@/lib/command-palette";
import { STRESS_DEFAULT_N, useStressRun } from "@/lib/stress";
import type { UseTimeSkipApi } from "@/lib/time-skip";

// useKeyboardShortcuts wires the global hotkeys advertised in the palette:
//   ⌘/Ctrl+K  toggle the command palette (works everywhere, even in inputs)
//   R         replay the last 5 minutes (The Time Skip)
//   S         stress-test (the Take-Off)
//   ?         open the palette as a help surface
//
// Single-key shortcuts are suppressed while the user is typing in a field or
// while the palette is open, so they never fight text entry. ⌘K is the one
// exception — it should toggle from anywhere.

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function useKeyboardShortcuts(timeSkip: UseTimeSkipApi) {
  const stress = useStressRun();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key;

      // ⌘/Ctrl+K toggles the palette from anywhere, including inputs.
      if ((e.metaKey || e.ctrlKey) && (k === "k" || k === "K")) {
        e.preventDefault();
        useCommandPalette.getState().toggle();
        return;
      }

      // Below here: bare single-key shortcuts. Never hijack text entry, other
      // modifier chords, or keys while the palette owns the keyboard.
      if (isEditable(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (useCommandPalette.getState().open) return;

      if (k === "r" || k === "R") {
        e.preventDefault();
        timeSkip.replayLast(5);
      } else if (k === "s" || k === "S") {
        e.preventDefault();
        stress.run(STRESS_DEFAULT_N);
      } else if (k === "?") {
        e.preventDefault();
        useCommandPalette.getState().setOpen(true);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeSkip, stress]);
}
