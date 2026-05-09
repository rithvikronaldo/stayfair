"use client";

import { useEffect } from "react";

import { hydrateSoundPref, useSound } from "@/lib/sound";

export function SoundToggle() {
  const muted = useSound((s) => s.muted);
  const toggle = useSound((s) => s.toggle);

  useEffect(() => {
    hydrateSoundPref();
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      title={muted ? "Sound off (click to enable)" : "Sound on (click to mute)"}
      className="flex h-6 w-6 items-center justify-center border border-border text-muted hover:text-fg"
    >
      {muted ? (
        <svg width="11" height="11" viewBox="0 0 11 11">
          <path
            d="M1 4v3h2l3 2.5v-8L3 4H1z"
            fill="currentColor"
          />
          <path
            d="M8 3.5l2.5 2.5M10.5 3.5L8 6"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 11 11">
          <path d="M1 4v3h2l3 2.5v-8L3 4H1z" fill="currentColor" />
          <path
            d="M8 3.2c0.7 0.7 0.7 2.4 0 3.1M9.5 1.8c1.5 1.5 1.5 5.4 0 6.9"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      )}
    </button>
  );
}
