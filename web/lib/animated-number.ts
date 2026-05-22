"use client";

import { useEffect, useState } from "react";
import { animate } from "motion/react";

import { DUR, EASE } from "@/lib/motion";

// useAnimatedNumber smoothly tweens between numeric values. Returns the
// current in-flight value; the caller formats it however they want (e.g. via
// fmtMinor + split into whole/frac). Animation runs at the standard entrance
// duration with the outExpo curve, matching the rest of the app's motion
// language (project_first_touch_craft anti-meh spec, W5 D4).
//
// Why imperative animate() and not useSpring/useTransform: balances render
// as split whole/frac with different typography on each part. MotionValue
// can't be split mid-JSX. Imperative animation with setState per frame is
// simpler and the re-render cost is fine for the ~30 accounts we show.
//
// First mount lands on the initial value without animation — we don't want
// every counter to count up from 0 on page load.

export function useAnimatedNumber(target: number): number {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (value === target) return;
    const controls = animate(value, target, {
      duration: DUR.entrance,
      ease: EASE.outExpo,
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
    // We intentionally re-run only when the target changes; `value` is the
    // animation source, not a re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}
