"use client";

import { create } from "zustand";

// Shared open-state + mode for the in-app Action dialog (spawn account / post
// transaction), so the topbar "+ New" button and the command palette can both
// open it to a specific tab without prop-drilling.
export type ActionMode = "spawn" | "post";

type ActionDialogState = {
  open: boolean;
  mode: ActionMode;
  // prefillDest pre-selects the "To" account when the dialog opens in post
  // mode — used by the "Fund this account" shortcut on empty account cards.
  // PostForm consumes it on mount and calls clearPrefill so it doesn't stick.
  prefillDest: string | null;
  openDialog: (mode: ActionMode, opts?: { dest?: string }) => void;
  close: () => void;
  clearPrefill: () => void;
};

export const useActionDialog = create<ActionDialogState>((set) => ({
  open: false,
  mode: "post",
  prefillDest: null,
  openDialog: (mode, opts) =>
    set({ open: true, mode, prefillDest: opts?.dest ?? null }),
  close: () => set({ open: false, prefillDest: null }),
  clearPrefill: () => set({ prefillDest: null }),
}));
