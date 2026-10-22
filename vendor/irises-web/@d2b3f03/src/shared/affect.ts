import { computeClock } from './clock';
import type {
  AffectMove, AffectState, ClockInfo, EpistemicTrigger, GaugeKey, Gauges, MoodShift,
} from './types';
import { CORE_VALENCE_BAND, coreForLabel, normalizeMoodLabel } from './wheel';

export const GAUGE_SPECS = [
  { key: 'mood_level', dflt: 50, up: 6, down: 8 },
  { key: 'anxiety', dflt: 50, up: 8, down: 5 },
  { key: 'warmth', dflt: 50, up: 4, down: 6 },
  { key: 'social_battery', dflt: 50, up: 5, down: 7 },
  { key: 'patience', dflt: 50, up: 5, down: 7 },
  { key: 'rapport', dflt: 40, up: 1, down: 2 },
] as const;

const MOOD_TARGET_PULL = 2;
const BROKE_STEP_MULTIPLIER = 3;
const EPISTEMIC_STEP_WIDENING = 1.5;
const AFFECT_TURN_CAP = 18;
const MOOD_WINDOW_MS = 60 * 60 * 1000;
const MOOD_WINDOW_CAP = 20;
const BROKE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MOVES_CAP = 64;

const SHIFT_SIGN: Record<MoodShift, number> = { lifted: 1, steady: 0, dipped: -1, broke: -1 };
const WIDENING: readonly EpistemicTrigger[] = ['logic_valid', 'knowledge_gap'];

export interface DriftInput { moodShift: MoodShift; moodLabel: string; epistemic: EpistemicTrigger }

type Targeted = Exclude<GaugeKey, 'rapport'>;

export function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function defaultGauges(): Gauges {
  const g = {} as Gauges;
  for (const s of GAUGE_SPECS) g[s.key] = s.dflt;
  return g;
}

export function affectTargets(clock: Pick<ClockInfo, 'energy' | 'cycleLoad'>): Record<Targeted, number> {
  const load = clock.cycleLoad;
  const energy = clock.energy;
  return {
    mood_level: clampInt(55 + 0.25 * (energy - 50) - 0.30 * (load - 40), 1, 100),
    anxiety: clampInt(35 + 0.45 * load - 0.25 * (energy - 50), 1, 100),
    warmth: clampInt(60 + 0.30 * (energy - 50) - 0.20 * (load - 40), 1, 100),
    social_battery: clampInt(20 + 0.70 * energy - 0.25 * load, 1, 100),
    patience: clampInt(75 - 0.35 * load + 0.15 * (energy - 50), 1, 100),
  };
}

function boundsFor(key: GaugeKey, moodLabel: string): [number, number] {
  if (key !== 'mood_level') return [1, 100];
  return CORE_VALENCE_BAND[coreForLabel(moodLabel)];
}

function spentInWindow(ledger: readonly AffectMove[], key: GaugeKey, now: number, windowMs: number): number {
  return ledger.filter(m => m.k === key && m.at > now - windowMs).reduce((sum, m) => sum + Math.abs(m.d), 0);
}

export function applyAffectDrift(
  current: Gauges,
  input: DriftInput,
  clock: Pick<ClockInfo, 'energy' | 'cycleLoad'>,
  ledger: readonly AffectMove[],
  now: number,
): { next: Gauges; moves: AffectMove[] } {
  const targets = affectTargets(clock);
  const brokeSpent = ledger.some(m => m.broke === true && m.at > now - BROKE_WINDOW_MS);
  const brokeDowngraded = input.moodShift === 'broke' && brokeSpent;
  const moodLeft = Math.max(0, MOOD_WINDOW_CAP - spentInWindow(ledger, 'mood_level', now, MOOD_WINDOW_MS));

  const next = {} as Gauges;
  for (const s of GAUGE_SPECS) {
    const [lo, hi] = boundsFor(s.key, input.moodLabel);
    const raw = Number(current?.[s.key]);
    next[s.key] = clampInt(Number.isFinite(raw) ? raw : s.dflt, lo, hi);
  }

  const moves: AffectMove[] = [...ledger];
  let spent = 0;
  for (const s of GAUGE_SPECS) {
    const cur = next[s.key];
    let delta = 0;
    if (s.key === 'mood_level') {
      const sign = SHIFT_SIGN[input.moodShift] ?? 0;
      const mult = input.moodShift === 'broke' && !brokeDowngraded ? BROKE_STEP_MULTIPLIER : 1;
      const widen = WIDENING.includes(input.epistemic) ? EPISTEMIC_STEP_WIDENING : 1;
      const step = sign === 0 ? 0 : Math.round((sign > 0 ? s.up : s.down) * mult * widen);
      const gap = targets.mood_level - (cur + sign * step);
      delta = sign * step + Math.sign(gap) * Math.min(Math.abs(gap), MOOD_TARGET_PULL);
    } else if (s.key !== 'rapport') {
      const gap = targets[s.key] - cur;
      delta = Math.sign(gap) * Math.min(Math.abs(gap), gap > 0 ? s.up : s.down);
    }
    if (delta === 0) continue;
    const [lo, hi] = boundsFor(s.key, input.moodLabel);
    const wanted = clampInt(cur + delta, lo, hi) - cur;
    if (wanted === 0) continue;
    let budget = Math.max(0, AFFECT_TURN_CAP - spent);
    if (s.key === 'mood_level') budget = Math.min(budget, moodLeft);
    const applied = Math.sign(wanted) * Math.min(Math.abs(wanted), budget);
    if (applied === 0) continue;
    next[s.key] = cur + applied;
    spent += Math.abs(applied);
    const broke = s.key === 'mood_level' && input.moodShift === 'broke' && !brokeDowngraded;
    moves.push(broke ? { at: now, k: s.key, d: applied, broke: true } : { at: now, k: s.key, d: applied });
  }
  const kept = moves.filter(m => m.at > now - BROKE_WINDOW_MS).slice(-MOVES_CAP);
  return { next, moves: kept };
}

export function initialAffect(nowMs: number, tz: string): AffectState {
  const targets = affectTargets(computeClock(nowMs, tz));
  return {
    v: 1,
    gauges: { ...targets, rapport: 40 },
    moodLabel: '',
    moodShift: 'steady',
    intent: null,
    note: '',
    hookTrail: [],
    moves: [],
    turns: 0,
    pending: null,
    delegations: 0,
    at: nowMs,
  };
}

export function advanceAffect(
  state: AffectState,
  s: { mood_label: string; mood_shift: MoodShift; epistemic_trigger: EpistemicTrigger },
  clock: Pick<ClockInfo, 'energy' | 'cycleLoad'>,
  now: number,
): AffectState {
  const label = normalizeMoodLabel(coreForLabel(s.mood_label), s.mood_label);
  const { next, moves } = applyAffectDrift(
    state.gauges, { moodShift: s.mood_shift, moodLabel: label, epistemic: s.epistemic_trigger }, clock, state.moves, now,
  );
  return { ...state, gauges: next, moves, moodLabel: label, moodShift: s.mood_shift, at: now };
}
