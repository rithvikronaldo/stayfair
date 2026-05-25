"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { api, formatMinor } from "@/lib/api";
import { playTickIfUnmuted } from "@/lib/sound";
import { useStore } from "@/lib/store";

// useCaptureFlow drives The Catch — the guided-flow step that settles the
// seeded pending authorization. It fetches the newest pending auth, captures
// it in full, then optimistically applies the result to the store so the
// animation fires immediately (source ticks down, dest ticks up, row pulses,
// soft tick if sound is on). We can't wait for the 5s self-mode poll — the
// click has to feel instant.
//
// Returns true when a capture actually happened, false when there was nothing
// pending or the request failed, so the caller can decide whether to advance
// the guided tour.

export type UseCaptureApi = {
  capturePending: () => Promise<boolean>;
};

export function useCaptureFlow(): UseCaptureApi {
  const capturePending = useCallback(async (): Promise<boolean> => {
    try {
      const pending = await api.listAuthorizations({
        status: "pending",
        limit: 1,
      });
      if (pending.length === 0) {
        toast("Nothing to capture", {
          description: "No pending authorizations on your ledger right now.",
        });
        return false;
      }

      const auth = pending[0];
      const res = await api.capture(auth.id, auth.amount);
      useStore
        .getState()
        .applyAuthCaptured(res.authorization_id, res.transaction);
      playTickIfUnmuted();

      toast.success("Captured", {
        description: `${formatMinor(auth.amount, auth.currency)} cleared from hold.`,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("capture failed", { description: message });
      return false;
    }
  }, []);

  return { capturePending };
}
