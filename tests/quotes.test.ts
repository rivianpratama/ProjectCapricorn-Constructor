import { describe, expect, it } from 'vitest';
import { isQuoteInTranscript, verifyEvidence } from '../src/lib/pipeline/quotes';
import type { Message } from '../src/lib/chats/types';

let id = 0;
const message = (sender: string, text: string): Message => ({
  id: id++,
  date: '2025-01-01',
  time: '10:00:00',
  timestamp: id,
  sender,
  text,
});

const messages = [
  message('Icha', 'Bntrrr'),
  message('Icha', 'nomor 75 yak'),
  message('Icha', 'pager item yg pohonnya rimbun ituu'),
  message('Raka', 'waah where is that'),
  message('Icha', 'dari sini gampang'),
  message('Icha', 'iyaaa 😂 ini tempat teppanyaki baru'),
];
const transcript = messages.map(entry => entry.text).join('\n');
const found = (quote: string) => isQuoteInTranscript(quote, transcript, messages);

describe('isQuoteInTranscript', () => {
  it('finds an exact quote', () => {
    expect(found('nomor 75 yak')).toBe(true);
  });

  it('finds bubbles joined with a slash, the exemplar convention leaking into a finding', () => {
    expect(found('nomor 75 yak / pager item yg pohonnya rimbun ituu')).toBe(true);
  });

  it('finds a joined quote with a media or location marker left in it', () => {
    expect(found('Bntrrr / [Location] / Nomor 75 yak / Pager item yg pohonnya rimbun ituu')).toBe(true);
  });

  it('needs only half of a multi-bubble quote to be real', () => {
    expect(found('nomor 75 yak / something nobody said')).toBe(true);
  });

  it('does not rescue a quote whose words are not in the transcript', () => {
    expect(found('meet me at the station at nine')).toBe(false);
    expect(found('nomor 99 yuk / something nobody said')).toBe(false);
  });

  it('finds a quote with a speaker label, curly quotes or escaped quotes', () => {
    expect(found('Icha: nomor 75 yak')).toBe(true);
    expect(found('“nomor 75 yak”')).toBe(true);
    expect(found('\\"nomor 75 yak\\"')).toBe(true);
  });

  it('finds a quote with different casing, punctuation or spacing', () => {
    expect(found('Nomor  75 yak!')).toBe(true);
    expect(found('dari sini gampang 😅')).toBe(true);
  });

  it('finds the bubble next to an emoji', () => {
    expect(found('ini tempat teppanyaki baru')).toBe(true);
  });

  it('refuses an empty quote', () => {
    expect(found('   ')).toBe(false);
  });
});

describe('verifyEvidence', () => {
  it('keeps the quotes that verify and reports the ones that do not', () => {
    const findings = [
      { quotes: ['nomor 75 yak', 'Bntrrr / [Location] / Nomor 75 yak / Pager item yg pohonnya rimbun ituu'] },
      { quotes: ['never said this'] },
    ];
    const evidence = verifyEvidence(findings, messages);
    expect(evidence).toEqual({ total: 3, verified: 2, missing: ['never said this'] });
    expect(findings[0].quotes).toHaveLength(2);
    expect(findings[1].quotes).toEqual([]);
  });
});
