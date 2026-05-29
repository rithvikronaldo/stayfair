"use client";

import { create } from "zustand";

const STORAGE_KEY = "acta.sound.muted";

let ctx: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function tick(amplitude = 0.04) {
  const c = ensureContext();
  if (!c) return;
  const t = c.currentTime;

  // Two-osc terminal blip: 880Hz primary + 1320Hz overtone, ~80ms decay.
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(amplitude, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  gain.connect(c.destination);

  const o1 = c.createOscillator();
  o1.type = "triangle";
  o1.frequency.setValueAtTime(880, t);
  o1.frequency.exponentialRampToValueAtTime(660, t + 0.08);
  o1.connect(gain);

  const o2 = c.createOscillator();
  o2.type = "sine";
  o2.frequency.setValueAtTime(1320, t);
  o2.connect(gain);

  o1.start(t);
  o2.start(t);
  o1.stop(t + 0.1);
  o2.stop(t + 0.1);
}

// rewind — a soft descending sweep paired with the Time Skip rewind motion
// (REWIND_MS ≈ 700 ms in time-skip.ts). Inverse of whoosh: starts high,
// drops, fades. Filtered triangle so it feels like tape, not a saw lead.
export function rewind(amplitude = 0.04) {
  const c = ensureContext();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.6;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(amplitude, t + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(c.destination);

  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(180, t + dur);
  o.connect(gain);

  o.start(t);
  o.stop(t + dur + 0.02);
}

// whoosh — a rising sweep for the Take-Off launch. The W6 D1 integration
// point; W6 D2 may swap the synth for a recorded cue. Kept intentionally
// short and low-amplitude so repeated stress runs don't fatigue.
export function whoosh(amplitude = 0.05) {
  const c = ensureContext();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.5;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(amplitude, t + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(c.destination);

  const o = c.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(1400, t + dur);
  o.connect(gain);

  o.start(t);
  o.stop(t + dur + 0.02);
}

// chime — The Return cue, fired when the user snaps back to LIVE after a
// Replay. Brighter and warmer than `tick`: two overtones over a 660 Hz base
// with a short attack and natural-feeling decay. ~300 ms total.
export function chime(amplitude = 0.05) {
  const c = ensureContext();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.32;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(amplitude, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(c.destination);

  const fundamental = c.createOscillator();
  fundamental.type = "sine";
  fundamental.frequency.setValueAtTime(660, t);
  fundamental.connect(gain);

  const fifth = c.createOscillator();
  fifth.type = "sine";
  fifth.frequency.setValueAtTime(990, t);
  // Quieter overtone so the fundamental dominates.
  const overGain = c.createGain();
  overGain.gain.setValueAtTime(0.5, t);
  fifth.connect(overGain).connect(gain);

  const upper = c.createOscillator();
  upper.type = "sine";
  upper.frequency.setValueAtTime(1980, t);
  const upperGain = c.createGain();
  upperGain.gain.setValueAtTime(0.18, t);
  upper.connect(upperGain).connect(gain);

  fundamental.start(t);
  fifth.start(t);
  upper.start(t);
  fundamental.stop(t + dur + 0.02);
  fifth.stop(t + dur + 0.02);
  upper.stop(t + dur + 0.02);
}

// thud — a short low landing tone when the run completes (paired with the
// invariant badge snapping green). Also a W6 D1 integration point.
export function thud(amplitude = 0.06) {
  const c = ensureContext();
  if (!c) return;
  const t = c.currentTime;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(amplitude, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  gain.connect(c.destination);

  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
  o.connect(gain);

  o.start(t);
  o.stop(t + 0.24);
}

type SoundState = {
  muted: boolean;
  toggle: () => void;
  setMuted: (b: boolean) => void;
};

// Always start muted=true so SSR and first client render match. Real
// preference is loaded by the SoundToggle's mount effect.
export const useSound = create<SoundState>((set) => ({
  muted: true,
  toggle: () =>
    set((s) => {
      const next = !s.muted;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // storage unavailable
      }
      if (!next) ensureContext(); // user-gesture init for Safari
      return { muted: next };
    }),
  setMuted: (b) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(b));
    } catch {
      // storage unavailable
    }
    set({ muted: b });
  },
}));

export function hydrateSoundPref() {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "false") useSound.getState().setMuted(false);
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && ctx?.state === "running") void ctx.suspend();
      else if (!document.hidden && ctx?.state === "suspended") void ctx.resume();
    },
    { passive: true },
  );
}

export function playTickIfUnmuted() {
  if (useSound.getState().muted) return;
  tick();
}

export function playWhooshIfUnmuted() {
  if (useSound.getState().muted) return;
  whoosh();
}

export function playThudIfUnmuted() {
  if (useSound.getState().muted) return;
  thud();
}

export function playChimeIfUnmuted() {
  if (useSound.getState().muted) return;
  chime();
}

export function playRewindIfUnmuted() {
  if (useSound.getState().muted) return;
  rewind();
}
