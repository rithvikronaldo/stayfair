"use client";

import { useEffect } from "react";

import { API_URL } from "@/lib/api";
import type { Authorization, Agent, PostedTransaction } from "@/lib/api";
import { playTickIfUnmuted } from "@/lib/sound";
import { useStore } from "@/lib/store";

type EventEnvelope<T> = {
  type: string;
  timestamp: string;
  payload: T;
};

export function useEventStream() {
  useEffect(() => {
    const setConnected = useStore.getState().setConnected;
    const apply = useStore.getState();

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource(`${API_URL}/events/stream`);

      es.addEventListener("connected", () => setConnected(true));

      es.addEventListener("agent_spawned", (e) => {
        const env = parse<Agent>(e.data);
        if (env) apply.applyAgentSpawned(env.payload);
      });

      es.addEventListener("auth_created", (e) => {
        const env = parse<Authorization>(e.data);
        if (env) apply.applyAuthCreated(env.payload);
      });

      es.addEventListener("auth_captured", (e) => {
        const env = parse<{
          authorization_id: string;
          transaction: PostedTransaction;
        }>(e.data);
        if (!env) return;
        apply.applyAuthCaptured(env.payload.authorization_id, env.payload.transaction);
        playTickIfUnmuted();
      });

      es.addEventListener("auth_voided", (e) => {
        const env = parse<{ authorization_id: string }>(e.data);
        if (env) apply.applyAuthVoided(env.payload.authorization_id);
      });

      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, 1500);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      setConnected(false);
    };
  }, []);
}

function parse<T>(raw: string): EventEnvelope<T> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.payload === "string") {
      try {
        parsed.payload = JSON.parse(parsed.payload);
      } catch {
        // leave as string
      }
    }
    return parsed as EventEnvelope<T>;
  } catch {
    return null;
  }
}
