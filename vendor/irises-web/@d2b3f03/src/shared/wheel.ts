import type { MoodCore } from './types';

export const MOOD_CORES: readonly MoodCore[] = ['mad', 'scared', 'joyful', 'powerful', 'peaceful', 'sad'];

export const WILLCOX_WHEEL: Record<MoodCore, { secondary: string[]; tertiary: string[] }> = {
  mad: {
    secondary: ['hurt', 'hostile', 'angry', 'rage', 'hateful', 'critical'],
    tertiary: ['jealous', 'selfish', 'frustrated', 'furious', 'irritated', 'skeptical'],
  },
  scared: {
    secondary: ['rejected', 'confused', 'helpless', 'submissive', 'insecure', 'anxious'],
    tertiary: ['bewildered', 'discouraged', 'insignificant', 'weak', 'foolish', 'embarrassed'],
  },
  joyful: {
    secondary: ['excited', 'sexy', 'energetic', 'playful', 'creative', 'aware'],
    tertiary: ['daring', 'fascinating', 'stimulating', 'amused', 'extravagant', 'delightful'],
  },
  powerful: {
    secondary: ['proud', 'respected', 'appreciated', 'important', 'faithful', 'hopeful'],
    tertiary: ['cheerful', 'satisfied', 'valuable', 'worthwhile', 'intelligent', 'confident'],
  },
  peaceful: {
    secondary: ['content', 'thoughtful', 'intimate', 'loving', 'trusting', 'nurturing'],
    tertiary: ['thankful', 'sentimental', 'serene', 'responsive', 'relaxed', 'pensive'],
  },
  sad: {
    secondary: ['guilty', 'ashamed', 'depressed', 'lonely', 'bored', 'sleepy'],
    tertiary: ['apathetic', 'inferior', 'inadequate', 'miserable', 'stupid', 'bashful'],
  },
};

export const EXTENDED_WORDS: Record<MoodCore, string[]> = {
  mad: ['snapped'],
  scared: ['overwhelmed'],
  joyful: ['cheerful', 'delighted', 'stimulated', 'curious', 'fascinated'],
  powerful: [],
  peaceful: ['tender'],
  sad: ['drained', 'withdrawn', 'tired'],
};

export const CORE_VALENCE_BAND: Record<MoodCore, [number, number]> = {
  joyful: [70, 100],
  powerful: [65, 95],
  peaceful: [55, 85],
  mad: [20, 45],
  scared: [12, 42],
  sad: [1, 35],
};

/** Display colour per core (demo only, not from Irises). */
export const CORE_COLOR: Record<MoodCore, string> = {
  joyful: '#FFE14D',
  powerful: '#FF9F1C',
  peaceful: '#9BE22D',
  sad: '#4DA3FF',
  scared: '#B78CFF',
  mad: '#FF4D4D',
};

function wheelWords(core: MoodCore): string[] {
  return [...WILLCOX_WHEEL[core].secondary, ...WILLCOX_WHEEL[core].tertiary];
}

export function feelingWords(core: MoodCore): string[] {
  return [...wheelWords(core), ...EXTENDED_WORDS[core]];
}

// Extended words first so a word in both lists (cheerful) files under its wheel core, as in Irises.
const CORE_BY_WORD: ReadonlyMap<string, MoodCore> = new Map<string, MoodCore>([
  ...MOOD_CORES.flatMap(c => EXTENDED_WORDS[c].map(w => [w, c] as [string, MoodCore])),
  ...MOOD_CORES.flatMap(c => wheelWords(c).map(w => [w, c] as [string, MoodCore])),
]);

export function coreForLabel(label: string): MoodCore {
  return CORE_BY_WORD.get(String(label ?? '').trim().toLowerCase()) ?? 'peaceful';
}

export function normalizeMoodLabel(core: MoodCore, label: unknown): string {
  if (typeof label === 'string') {
    const l = label.trim().toLowerCase();
    if (CORE_BY_WORD.has(l)) return l;
  }
  return WILLCOX_WHEEL[core].secondary[0];
}

export function vocabularyLines(): string {
  return MOOD_CORES.map(c => `- ${c} covers ${feelingWords(c).join(', ')}`).join('\n');
}
