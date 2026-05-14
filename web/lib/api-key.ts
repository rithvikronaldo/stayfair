"use client";

import { create } from "zustand";

const STORAGE_KEY = "stayfair.api_key";
const EMAIL_KEY = "stayfair.api_key.email";

type State = {
  apiKey: string | null;
  email: string | null;
  set: (apiKey: string, email: string) => void;
  clear: () => void;
};

// Starts null on both server and first client render so hydration is exact.
// hydrateApiKey() runs once on mount (called from the LandingStrip) and pulls
// any stored values into the store. Subsequent renders see the real key.
export const useApiKey = create<State>((set) => ({
  apiKey: null,
  email: null,
  set: (apiKey, email) => {
    try {
      localStorage.setItem(STORAGE_KEY, apiKey);
      localStorage.setItem(EMAIL_KEY, email);
    } catch {
      // storage unavailable (private mode, quota); the in-memory store still
      // holds the key for the session, so the dashboard works until reload.
    }
    set({ apiKey, email });
  },
  clear: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      // ignore
    }
    set({ apiKey: null, email: null });
  },
}));

export function hydrateApiKey() {
  if (typeof window === "undefined") return;
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    const email = localStorage.getItem(EMAIL_KEY);
    if (key) {
      useApiKey.setState({ apiKey: key, email: email ?? "" });
    }
  } catch {
    // ignore
  }
}
