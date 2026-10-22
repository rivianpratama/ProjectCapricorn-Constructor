import type { FamiliarityBand } from './types';

/** Band floors from Irises familiarity.ts. */
export const BAND_FLOORS: Record<FamiliarityBand, number> = { stranger: 1, acquaintance: 25, familiar: 50, close: 75 };

export function bandFor(score: number): FamiliarityBand {
  if (score >= BAND_FLOORS.close) return 'close';
  if (score >= BAND_FLOORS.familiar) return 'familiar';
  if (score >= BAND_FLOORS.acquaintance) return 'acquaintance';
  return 'stranger';
}

/** Demo score: Irises' "turns" evidence row only (0.25 a turn, capped at 20). A demo visitor stays a stranger, honestly. */
export function familiarityOf(turns: number): { score: number; band: FamiliarityBand } {
  const score = Math.round(1 + Math.min(20, Math.max(0, turns) * 0.25));
  return { score, band: bandFor(score) };
}
