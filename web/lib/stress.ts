"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

// useStressRun is a small driver around the synchronous POST /stress.
// During the request, the dashboard renders the Take-Off chart in
// "running" phase — that overlay extrapolates the rising line on its own
// using stressN + stressStartedAt. When the response lands, we record the
// result and the chart snaps to actual final values.
//
// One-shot per click. Re-triggering while a run is in flight is a no-op
// (the button is disabled in the UI; this guards programmatic callers).

export const STRESS_DEFAULT_N = 1000;

export type UseStressApi = {
  run: (n?: number) => Promise<void>;
  reset: () => void;
};

export function useStressRun(): UseStressApi {
  const run = useCallback(async (n: number = STRESS_DEFAULT_N) => {
    const phase = useStore.getState().stressPhase;
    if (phase === "running") return;

    useStore.getState().startStress(n);

    try {
      const result = await api.stress(n);
      useStore.getState().completeStress(result);
    } catch (err) {
      useStore.getState().resetStress();
      const message = err instanceof Error ? err.message : String(err);
      toast.error("stress failed", { description: message });
    }
  }, []);

  const reset = useCallback(() => {
    useStore.getState().resetStress();
  }, []);

  return { run, reset };
}
