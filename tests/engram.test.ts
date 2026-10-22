import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGRAIN_SECTIONS, parseEngram } from '../src/lib/schema/engram';

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'engram.md'), 'utf8');

describe('parseEngram', () => {
  const engram = parseEngram(fixture, 'chat-1');

  it('reads every section in order', () => {
    expect(Object.keys(engram.sections)).toEqual(ENGRAIN_SECTIONS.map((name, i) => `${i + 1}. ${name}`));
  });

  it('reads findings with quotes, frequency, scope and confidence', () => {
    expect(engram.findings.length).toBeGreaterThanOrEqual(5);
    const finding = engram.findings.find(item => item.id === 'bubble-split');
    expect(finding).toMatchObject({ frequency: 'often', scope: 'in this chat', confidence: 'high' });
    expect(finding?.quotes).toEqual(['it was so good', 'i got the weird menu thing']);
  });

  it('keeps every quote a real substring of the source', () => {
    for (const finding of engram.findings) {
      for (const quote of finding.quotes) expect(fixture).toContain(quote);
    }
  });

  it('reads exemplars with bubbles kept and tags split', () => {
    expect(engram.exemplars).toHaveLength(9);
    expect(engram.exemplars[0]).toEqual({
      stimulus: 'and????',
      reply: ['it was so good', 'i got the weird menu thing'],
      move: 'share',
      mood: 'warm',
      specificity: 'generic',
    });
  });

  it('collects at least eight distinct moves', () => {
    expect(engram.moves.length).toBeGreaterThanOrEqual(8);
  });

  it('rejects a document with a missing section', () => {
    const broken = fixture.replace('## 8. Drift\nWarmer in the late slice, faster replies, fewer explanations.\n\n', '');
    expect(() => parseEngram(broken)).toThrow(/needs 11 sections, found 10/);
  });

  it('rejects a document whose sections are out of order', () => {
    const broken = fixture.replace('## 2. Surface (L3)', '## 2. Surfaces');
    expect(() => parseEngram(broken)).toThrow(/section 2 should be "2. Surface \(L3\)"/);
  });
});
