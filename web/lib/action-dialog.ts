"use client";

import { create } from "zustand";

// Shared open-state + mode for the in-app Action dialog (spawn account / post
// transaction), so the topbar "+ New" button and the command palette can both
// open it to a specific tab without prop-drilling.
export type ActionMode = "spawn" | "post";

type ActionDialogState = {
  open: boolean;
  mode: ActionMode;
  openDialog: (mode: ActionMode) => void;
  close: () => void;
};

export const useActionDialog = create<ActionDialogState>((set) => ({
  open: false,
  mode: "post",
  openDialog: (mode) => set({ open: true, mode }),
  close: () => set({ open: false }),
}));
