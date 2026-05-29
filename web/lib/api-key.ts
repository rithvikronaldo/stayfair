"use client";

import { create } from "zustand";

const STORAGE_KEY = "acta.api_key";
const EMAIL_KEY = "acta.api_key.email";
const TENANT_CREATED_AT_KEY = "acta.api_key.tenant_created_at";

type State = {
  apiKey: string | null;
  email: string | null;
  // ISO timestamp of the tenant's original creation. Used to gate the
  // First Tick window against server time so it doesn't restart on key
  // rotation or on a fresh browser for a months-old tenant.
  tenantCreatedAt: string | null;
  set: (apiKey: string, email: string, tenantCreatedAt: string) => void;
  clear: () => void;
};

// Starts null on both server and first client render so hydration is exact.
// hydrateApiKey() runs once on mount (called from the LandingStrip) and pulls
// any stored values into the store. Subsequent renders see the real key.
export const useApiKey = create<State>((set) => ({
  apiKey: null,
  email: null,
  tenantCreatedAt: null,
  set: (apiKey, email, tenantCreatedAt) => {
    try {
      localStorage.setItem(STORAGE_KEY, apiKey);
      localStorage.setItem(EMAIL_KEY, email);
      localStorage.setItem(TENANT_CREATED_AT_KEY, tenantCreatedAt);
    } catch {
      // storage unavailable (private mode, quota); the in-memory store still
      // holds the key for the session, so the dashboard works until reload.
    }
    set({ apiKey, email, tenantCreatedAt });
  },
  clear: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(TENANT_CREATED_AT_KEY);
    } catch {
      // ignore
    }
    set({ apiKey: null, email: null, tenantCreatedAt: null });
  },
}));

export function hydrateApiKey() {
  if (typeof window === "undefined") return;
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    const email = localStorage.getItem(EMAIL_KEY);
    const tenantCreatedAt = localStorage.getItem(TENANT_CREATED_AT_KEY);
    if (key) {
      useApiKey.setState({
        apiKey: key,
        email: email ?? "",
        tenantCreatedAt: tenantCreatedAt ?? null,
      });
    }
  } catch {
    // ignore
  }
}
