"use client";

import { create } from "zustand";

// Shared open-state for the Cmd-K command palette, so the global keyboard
// shortcut hook, the topbar, and the palette itself can all toggle it without
// prop-drilling through page.tsx.
type CommandPaletteState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

export const useCommandPalette = create<CommandPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
