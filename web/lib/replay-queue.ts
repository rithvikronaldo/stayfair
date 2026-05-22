"use client";

import { useEffect, useState } from "react";

import { api, type PostedTransaction } from "@/lib/api";
import { useStore } from "@/lib/store";

// Replay engine 1 — W5 D4. The queue is the *data substrate* The Time Skip
// (W5 D5–D6) iterates over. Today's job is correctness: when as_of becomes
// non-null, fetch every transaction with occurred_at in (as_of, now], reverse
// to oldest-first so playback runs forward, and expose the queue. Friday's
// choreography consumes this — the queue does not animate or play back today.
//
// Scope choices for engine 1:
//   - Transactions only. Auth_created/captured/voided events are not in the
//     queue yet — they're a richer story but the cinematic narrative reads
//     fine with txs alone, and the SSE event types can be folded in later if
//     Friday's polish demands it.
//   - Single-page fetch (limit=200). The seed produces 100 txs; live activity
//     between as_of and now is typically a handful. Pagination is a refinement
//     for if/when a tenant accumulates >200 events in their replay window.

export type ReplayEvent = {
  id: string;
  kind: "transaction";
  occurredAt: Date;
  tx: PostedTransaction;
};

export type ReplayQueueState = {
  queue: ReplayEvent[];
  isLoading: boolean;
  error: Error | null;
  // Anchor times. Useful for the playhead UI to know the playback range.
  asOf: Date | null;
  fetchedAt: Date | null;
};

const EMPTY: ReplayQueueState = {
  queue: [],
  isLoading: false,
  error: null,
  asOf: null,
  fetchedAt: null,
};

export function useReplayQueue(): ReplayQueueState {
  const asOf = useStore((s) => s.asOf);
  const [state, setState] = useState<ReplayQueueState>(EMPTY);

  useEffect(() => {
    if (asOf === null) {
      // Back to LIVE — clear the queue. Friday's playback engine will key
      // off this transition to teardown any in-flight animation.
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    const fetchedAt = new Date();

    setState((s) => ({ ...s, isLoading: true, error: null }));

    api
      .listTransactions({
        from: asOf.toISOString(),
        to: fetchedAt.toISOString(),
        limit: 200,
      })
      .then((page) => {
        if (cancelled) return;
        // API returns newest-first; reverse for replay (oldest-first so the
        // playhead moves forward in time).
        const queue: ReplayEvent[] = page.transactions
          .slice()
          .reverse()
          .map((tx) => ({
            id: tx.id,
            kind: "transaction" as const,
            occurredAt: new Date(tx.occurred_at),
            tx,
          }));
        setState({
          queue,
          isLoading: false,
          error: null,
          asOf,
          fetchedAt,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          queue: [],
          isLoading: false,
          error: err instanceof Error ? err : new Error(String(err)),
          asOf,
          fetchedAt,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [asOf]);

  return state;
}
