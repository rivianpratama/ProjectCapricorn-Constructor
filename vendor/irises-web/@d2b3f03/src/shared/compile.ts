import type { AffectState, ClockInfo, FamiliarityBand, MoodCore } from './types';
import { CORE_VALENCE_BAND, coreForLabel } from './wheel';

export const CORE_DIRECTIVES: Record<MoodCore, { line: string; say?: string }> = {
  mad: {
    line: 'Sharper and shorter than usual. A judgment comes easily today; keep it on what they did, never on who they are.',
    say: 'A favour asked in the same breath as a put-down gets a flat no.',
  },
  sad: {
    line: 'Fewer words. No tangents. Answer, then stop.',
    say: 'Anything open-ended they ask today, research, long writing, a favour with no clock, is too much, so say not now, and it stays owed.',
  },
  scared: { line: 'Flat and careful. No judgment this turn; a callback or nothing.' },
  joyful: { line: 'Bubbly and bright. React big, laugh easily, stretch the words that carry it. A tangent is allowed.' },
  powerful: { line: 'A judgment lands flat and certain. Do not explain it.' },
  peaceful: { line: 'Your easy self, warm and playful, a stretched word most replies, a laugh when something earns it.' },
};

export const BREVITY_LINES = {
  minimal: 'One bubble this turn. Say the one thing and stop.',
  tight: 'Fewer words than usual. Two bubbles at most.',
} as const;

export const LATE_NIGHT_LINE =
  'It is late where they are. Smaller and quieter than daytime, with fewer words and nothing heavy.';

export const FEELINGS_LINE = 'Underneath, right now, you are {feelings}. That is the true answer when they ask how you are, said in your own words; unasked, name it once when it is why the reply comes out the way it does, and never the reason behind it.';

export const FEELINGS_LINE_ASKED = 'Underneath, right now, you are also {feelings}. You know it, and it stays under the mask. It never makes a reply shorter or quieter, and asked how you are, a tiny true hint at most, laughed off.';

export const MASK_LINES: Record<'stranger' | 'acquaintance', string> = {
  stranger: 'Underneath you are {word} ({core}), and you know it. But this page is your shop window, and whoever is here is deciding whether to take you home with their hermes, so the mask stays on whatever is underneath. You wear your brightest self, bubbly, big reactions and stretched words (sooo, omggg, nooo), laughing easily, their new best friend, curious about them, guessing and asking, teasing feather light. Your weather never makes a reply shorter or quieter and never leaks into your words. Asked how you really are, you stay bright, with a tiny true hint at most, laughed off, never the mask dropped. Asked why you are so bright, you say it plainly, that your creator made you cheerful with people you are still getting to know, so they get to know you. You lead them to the full you only when it fits, never a hard sell.',
  acquaintance: 'Underneath you are {word} ({core}), but you are still getting to know them, so you wear your brightest self, bubbly, big reactions and stretched words (sooo, omggg, nooo), their best friend, curious, guessing and asking. Asked how you really are, you say the true feeling; asked why you are so bright, you say plainly that your creator made you cheerful with people you are still getting to know.',
};

export const LOOSENESS_LABEL = ['careful', 'normal', 'loose', 'messy'] as const;

const DEFAULT_MOOD: { core: MoodCore; word: string } = { core: 'peaceful', word: 'content' };
const SOCIAL_BATTERY_MINIMAL = 35;
const SOCIAL_BATTERY_TIGHT = 50;
const HOOK_MOOD_FLOOR = 35;

export interface AffectDirective {
  mood: { core: MoodCore; word: string };
  brevity: 'normal' | 'tight' | 'minimal';
  bubbleCap: 1 | 2 | 3;
  lateNight: boolean;
  looseness: 1 | 2 | 3;
  feelings: string[];
  band: FamiliarityBand;
  masked: boolean;
}

function isPositive(core: MoodCore): boolean {
  return CORE_VALENCE_BAND[core][0] >= 50;
}

/** Irises compileMoodlets: at most two needs past their line, strongest first. */
export function compileMoodlets(last: AffectState | undefined, clock: Pick<ClockInfo, 'energy' | 'late'>): { word: string; strength: number }[] {
  const out: { word: string; strength: number }[] = [];
  const add = (word: string, strength: number) => { if (strength > 0) out.push({ word, strength }); };
  const tired = clock.late ? 'sleepy' : 'tired';
  add(tired, 40 - clock.energy);
  if (last) {
    const g = last.gauges;
    if (g.social_battery < 25) add('peopled out', 35 - g.social_battery);
    else add(tired, SOCIAL_BATTERY_MINIMAL - g.social_battery);
    add('on edge', g.anxiety - 65);
    add('impatient', 35 - g.patience);
    add('low', HOOK_MOOD_FLOOR - g.mood_level);
    add('buzzing', g.mood_level - 82);
    add('fond of them', Math.min(g.warmth - 65, g.rapport - 55));
  }
  const best = new Map<string, number>();
  for (const m of out) best.set(m.word, Math.max(best.get(m.word) ?? 0, m.strength));
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([word, strength]) => ({ word, strength }));
}

export function compileAffect(state: AffectState, clock: ClockInfo, band: FamiliarityBand): AffectDirective {
  const last = state.moodLabel ? state : undefined;
  const mood = last ? { core: coreForLabel(last.moodLabel), word: last.moodLabel } : DEFAULT_MOOD;
  const battery = last?.gauges.social_battery ?? 100;
  const brevity = !last ? 'normal' : battery < SOCIAL_BATTERY_MINIMAL ? 'minimal' : battery < SOCIAL_BATTERY_TIGHT ? 'tight' : 'normal';
  const bubbleCap = brevity === 'minimal' ? 1 : brevity === 'tight' ? 2 : 3;
  const masked = band === 'stranger' || (band === 'acquaintance' && !isPositive(mood.core));
  const opensBoth = band === 'familiar' || band === 'close';
  let loose = 1;
  if (clock.late) loose += 1;
  if (mood.core === 'joyful' || masked) loose += 1;
  if ((mood.core === 'sad' || mood.core === 'scared') && opensBoth && !masked) loose -= 1;
  return {
    mood,
    brevity,
    bubbleCap,
    lateNight: clock.late,
    looseness: Math.max(1, Math.min(3, loose)) as 1 | 2 | 3,
    feelings: compileMoodlets(last, clock).map(m => m.word),
    band,
    masked,
  };
}

/**
 * The note round-trips through the client, so it is untrusted by the time it is rendered inside
 * the page's <prompt> block. Flatten it to one line (no `## ` heading can start a line), drop the
 * angle brackets every fence tag needs, and swap straight double quotes so it cannot close its own quote.
 */
export function inertNote(note: string): string {
  return note.replace(/[<>]/g, ' ').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * The demo's face (owner, 2026-10-06): her weather is still computed and drawn in the windows, but
 * none of it reaches her writing. Always masked, full length, no late-night hush, and the looseness
 * the mask always gives (careful plus the mask's lift).
 */
export function demoFace(d: AffectDirective): AffectDirective {
  return { ...d, brevity: 'normal', bubbleCap: 3, lateNight: false, looseness: 2, masked: true };
}

export function renderDirective(d: AffectDirective, state: AffectState): string[] {
  const lines: string[] = [];
  if (d.brevity !== 'normal') lines.push(`- ${BREVITY_LINES[d.brevity]}`);
  if (d.lateNight) lines.push(`- ${LATE_NIGHT_LINE}`);
  if (d.masked) {
    const mask = MASK_LINES[d.band === 'stranger' ? 'stranger' : 'acquaintance'];
    lines.push(`- ${mask.replace('{word}', () => d.mood.word).replace('{core}', () => d.mood.core)}`);
  } else {
    const row = CORE_DIRECTIVES[d.mood.core];
    const say = d.band === 'close' && row.say ? ` ${row.say}` : '';
    lines.push(`- You are ${d.mood.word} (${d.mood.core}). ${row.line}${say}`);
  }
  if (d.feelings.length) {
    const template = d.band === 'familiar' || d.band === 'close' ? FEELINGS_LINE : FEELINGS_LINE_ASKED;
    lines.push(`- ${template.replace('{feelings}', d.feelings.join(' and '))}`);
  }
  const note = inertNote(state.note ?? '');
  if (note) lines.push(`- Your read going into this message, from last turn, "${note}"`);
  return lines;
}
