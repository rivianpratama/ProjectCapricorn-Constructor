import { describe, expect, it } from 'vitest';
import {
  analyse,
  heldOutPairs,
  ngramIndex,
  openerDistinctness,
  overlapShare,
  pseudonymise,
} from '../src/lib/chats/analyse';
import type { Message } from '../src/lib/chats/types';

const messages: Message[] = [
  ['Raka', 'okay so i finally tried that place', '2024-03-12', '21:04'],
  ['Nadia', 'and????', '2024-03-12', '21:05'],
  ['Raka', 'it was so good', '2024-03-12', '21:06'],
  ['Raka', 'i got the weird menu thing', '2024-03-12', '21:06'],
  ['Nadia', 'SEE', '2024-03-12', '21:07'],
  ['Raka', 'wkwk fair', '2024-03-12', '21:08'],
].map(([sender, text, date, time], id) => ({
  id,
  sender,
  text,
  date,
  time: `${time}:00`,
  timestamp: Date.parse(`${date}T${time}:00`),
}));

describe('chat analysis', () => {
  it('pseudonymises everyone but the subject', () => {
    const out = pseudonymise(messages, 'Raka');
    expect(out[0].sender).toBe('Raka');
    expect(out[1].sender).toBe('Person A');
    expect(JSON.stringify(out)).not.toContain('Nadia');
  });

  it('computes subject-weighted stats', () => {
    const stats = analyse(messages, 'Raka');
    expect(stats.subjectMessages).toBe(4);
    expect(stats.subjectShare).toBeCloseTo(4 / 6);
    expect(stats.questionRate).toBe(0);
    expect(stats.topEmoji).toEqual([]);
    expect(stats.activeHours[21]).toBe(4);
    expect(stats.bubblesPerTurn).toBeGreaterThan(0);
    expect(stats.medianChars).toBeGreaterThan(0);
    expect(stats.p90Chars).toBeGreaterThanOrEqual(stats.medianChars);
    expect(stats.lowercaseStartRate).toBeGreaterThan(0);
    expect(stats.conversations).toBeGreaterThan(0);
    expect(stats.endsConversations).toBeLessThanOrEqual(stats.conversations);
    expect(Array.isArray(stats.stretchedWords)).toBe(true);
    expect(Array.isArray(stats.punctuationRuns)).toBe(true);
    expect(Array.isArray(stats.topNgrams)).toBe(true);
  });

  it('collects held-out stimulus and reply pairs', () => {
    const pairs = heldOutPairs(messages, 'Raka');
    expect(pairs).toHaveLength(2);
    expect(pairs[0].stimulus).toContain('Nadia: and????');
    expect(pairs[0].reply).toEqual(['it was so good', 'i got the weird menu thing']);
    expect(pairs[1].reply).toEqual(['wkwk fair']);
  });

  it('measures parroting and opener variety', () => {
    const index = ngramIndex(['i got the weird menu thing']);
    expect(overlapShare('i got the weird menu thing again', index)).toBeGreaterThan(0.5);
    expect(overlapShare('completely different words here', index)).toBe(0);
    expect(openerDistinctness([['wait'], ['wait'], ['okay']])).toBeCloseTo(2 / 3);
  });
});
