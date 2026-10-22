/** Irises' tuned typing numbers (src/state/pacing.ts): about a 220 wpm texter. */
export interface PacingConfig {
  cpm: number;
  minMs: number;
  maxMs: number;
  firstBubbleMaxMs: number;
  jitterPct: number;
  /** Before the dots first show for a turn. */
  readBeatMs: [number, number];
  /** Dots off between two bubbles of one reply. */
  gapMs: [number, number];
}

export const PACING: PacingConfig = {
  cpm: 1100,
  minMs: 400,
  maxMs: 2000,
  firstBubbleMaxMs: 600,
  jitterPct: 15,
  readBeatMs: [500, 1000],
  gapMs: [250, 450],
};

export function between([a, b]: [number, number], rand: () => number = Math.random): number {
  return Math.round(a + rand() * (b - a));
}

export function typingDelayMs(
  text: string,
  isFirst: boolean,
  cfg: PacingConfig = PACING,
  rand: () => number = Math.random,
): number {
  const chars = text.trim().length || 1;
  let ms = Math.min(Math.max((chars / cfg.cpm) * 60_000, cfg.minMs), cfg.maxMs);
  if (cfg.jitterPct > 0) ms *= 1 + ((rand() * 2 - 1) * cfg.jitterPct) / 100;
  if (isFirst) ms = Math.min(ms, cfg.firstBubbleMaxMs);
  return Math.round(ms);
}
