"use client";

import { useState } from "react";

import { useCodeMode } from "@/lib/code-mode";

// CurlHint wraps an action control and, when code mode is ON, reveals the curl
// equivalent on hover. Off by default, so it never clutters the product
// surface — it's the opt-in "show me the wire" affordance for the curious.
export function CurlHint({
  curl,
  children,
  align = "right",
  block = false,
}: {
  curl: string;
  children: React.ReactNode;
  align?: "left" | "right";
  block?: boolean;
}) {
  const on = useCodeMode((s) => s.on);
  const [hover, setHover] = useState(false);

  return (
    <span
      className={`relative ${block ? "block" : "inline-flex"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {on && hover && (
        <span
          role="tooltip"
          className={`absolute top-[calc(100%+6px)] z-50 w-[420px] max-w-[80vw] rounded-sm border border-border bg-surface-1 p-2.5 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <span className="num mb-1 block text-[10px] uppercase tracking-[0.14em] text-dim">
            curl
          </span>
          <pre className="num overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-fg">
            {curl}
          </pre>
        </span>
      )}
    </span>
  );
}
