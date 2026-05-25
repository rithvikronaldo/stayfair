"use client";

import { create } from "zustand";

// Code mode is the opt-in "show me the wire" surface. OFF by default — the
// product leads with the dashboard, not curl. When ON, action surfaces reveal
// the curl equivalent of what they do (the Action dialog shows a live curl
// preview; representative buttons show curl on hover). Persisted per browser.
const STORAGE_KEY = "acta.code_mode";

type CodeModeState = {
  on: boolean;
  toggle: () => void;
  setOn: (on: boolean) => void;
};

export const useCodeMode = create<CodeModeState>((set) => ({
  on: false,
  toggle: () =>
    set((s) => {
      const next = !s.on;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // storage unavailable
      }
      return { on: next };
    }),
  setOn: (on) => set({ on }),
}));

// Hydrate the persisted preference after mount. Start OFF so SSR and first
// client render agree, then flip on if the user previously enabled it.
export function hydrateCodeMode() {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      useCodeMode.getState().setOn(true);
    }
  } catch {
    // storage unavailable
  }
}
