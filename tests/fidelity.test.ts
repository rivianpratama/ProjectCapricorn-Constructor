import { describe, expect, it } from 'vitest';
import { realIsFirst, scoreLikeness, scoreParroting, THRESHOLDS, verdict } from '../src/lib/fidelity/score';

describe('likeness scoring', () => {
  it('counts how often the judge picked the real person', () => {
    const pairs = Array.from({ length: 4 }, (_, i) => ({ stimulus: `s${i}`, real: ['r'], generated: ['g'] }));
    const result = scoreLikeness(pairs, [
      { pickedReal: true, voice: 5, move: 4, emotion: 4 },
      { pickedReal: false, voice: 4, move: 5, emotion: 3 },
      { pickedReal: true, voice: 3, move: 4, emotion: 4 },
      { pickedReal: false, voice: 2, move: 5, emotion: 3 },
    ]);
    expect(result.realPicked).toBe(2);
    expect(result.total).toBe(4);
    expect(result.voice).toBe(3.5);
    expect(result.move).toBe(4.5);
    expect(result.emotion).toBe(3.5);
  });

  it('drops skipped pairs from every number', () => {
    const pairs = Array.from({ length: 3 }, (_, i) => ({ stimulus: `s${i}`, real: ['r'], generated: ['g'] }));
    const result = scoreLikeness(pairs, [
      { pickedReal: true, voice: 5, move: 5, emotion: 5 },
      { pickedReal: true, voice: 1, move: 1, emotion: 1, skipped: true },
      { pickedReal: true, voice: 5, move: 5, emotion: 5 },
    ]);
    expect(result.total).toBe(2);
    expect(result.realPicked).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.voice).toBe(5);
  });

  it('reports zero rather than NaN when every pair was skipped', () => {
    const pairs = [{ stimulus: 's', real: ['r'], generated: ['g'] }];
    const result = scoreLikeness(pairs, [{ pickedReal: false, voice: 1, move: 1, emotion: 1, skipped: true }]);
    expect(result).toMatchObject({ total: 0, realPicked: 0, voice: 0, move: 0, emotion: 0, skipped: 1 });
  });
});

describe('likeness scoring with an unreadable judge', () => {
  it('skips pairs the judge answered in prose instead of counting them as a miss', () => {
    const pairs = Array.from({ length: 4 }, (_, i) => ({ stimulus: `s${i}`, real: [`r${i}`], generated: [`g${i}`] }));
    const readable = { pickedReal: true, voice: 4, move: 4, emotion: 4 };
    const result = scoreLikeness(pairs, [readable, null, readable, null] as never);
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.realPicked).toBe(2);
  });
});

describe('parroting scoring', () => {
  it('scores a copy as heavy overlap and a fresh voice as low', () => {
    const subject = ['i got the weird menu thing and it was so good'];
    const copy = scoreParroting([['i got the weird menu thing and it was so good']], subject);
    const fresh = scoreParroting([['told u the pasta place was a trap']], subject);
    expect(copy.overlap).toBeGreaterThan(fresh.overlap);
  });

  it('scores opener variety across replies', () => {
    const varied = scoreParroting([['a one'], ['b two'], ['c three'], ['d four']], []);
    const same = scoreParroting([['same thing'], ['same thing'], ['same thing'], ['same thing']], []);
    expect(varied.openerDistinctness).toBeGreaterThan(same.openerDistinctness);
    expect(same.openerDistinctness).toBeLessThan(THRESHOLDS.minOpenerDistinctness);
  });
});

describe('verdict', () => {
  const good = {
    generalisation: { score: 4.2, judged: 8, missed: [] },
    parroting: { overlap: 0.1, openerDistinctness: 0.9, openers: [] },
  };

  it('passes a child that generalises and does not parrot', () => {
    const result = verdict(good);
    expect(result.generalisation).toBe(true);
    expect(result.parroting).toBe(true);
    expect(result.revise).toEqual([]);
  });

  it('asks for a revision on generalisation alone', () => {
    const result = verdict({ ...good, generalisation: { score: 2.1, judged: 8, missed: ['4'] } });
    expect(result.revise).toEqual(['generalisation']);
  });

  it('asks for a revision on parroting alone', () => {
    const result = verdict({ ...good, parroting: { overlap: 0.6, openerDistinctness: 0.9, openers: [] } });
    expect(result.revise).toEqual(['parroting']);
  });

  it('asks for both when both fail', () => {
    const result = verdict({
      generalisation: { score: 1, judged: 8, missed: ['1'] },
      parroting: { overlap: 0.9, openerDistinctness: 0.2, openers: [] },
    });
    expect(result.revise).toEqual(['generalisation', 'parroting']);
  });

  it('is deterministic about which side the real reply sits on', () => {
    expect(realIsFirst(0)).toBe(true);
    expect(realIsFirst(1)).toBe(false);
    expect(realIsFirst(2)).toBe(true);
  });
});
