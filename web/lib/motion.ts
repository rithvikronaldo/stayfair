import type { Transition, Variants } from "motion/react";

export const EASE = {
  outExpo: [0.16, 1, 0.3, 1] as const,
  outQuart: [0.25, 1, 0.5, 1] as const,
  inOutQuad: [0.45, 0, 0.55, 1] as const,
};

export const DUR = {
  micro: 0.08,
  ui: 0.16,
  entrance: 0.28,
  hero: 0.48,
} as const;

export const STAGGER = {
  standard: 0.03,
  dense: 0.02,
  hero: 0.06,
} as const;

export const SPRING_DRAG: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.entrance, ease: EASE.outExpo },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DUR.entrance, ease: EASE.outQuart },
  },
};

export const tickerStagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: STAGGER.standard,
      delayChildren: 0.1,
    },
  },
};

export const cardEnter: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.entrance, ease: EASE.outExpo },
  },
};

export const streamRowEnter: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: DUR.ui, ease: EASE.outQuart },
  },
  exit: {
    opacity: 0,
    transition: { duration: DUR.micro },
  },
};
