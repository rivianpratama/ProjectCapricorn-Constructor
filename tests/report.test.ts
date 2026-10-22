import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_SECTIONS, parseReport } from '../src/lib/schema/report';

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'report.md'), 'utf8');

describe('parseReport', () => {
  const report = parseReport(fixture);

  it('reads every section in order', () => {
    expect(Object.keys(report.sections)).toEqual(REPORT_SECTIONS.map((name, i) => `${i + 1}. ${name}`));
  });

  it('reads the ledger with supporting and contradicting sources', () => {
    expect(report.ledger).toHaveLength(3);
    expect(report.ledger[0]).toMatchObject({
      id: 'taken-seriously',
      supporting: ['chat-1', 'chat-2'],
      contradicting: ['chat-3'],
      confidence: 'high',
    });
    expect(report.ledger[1].contradicting).toEqual([]);
    expect(report.ledger[2].supporting).toEqual(['chat-1']);
  });

  it('requires each drive to cite at least two sources', () => {
    expect(report.drives).toHaveLength(4);
    for (const drive of report.drives) expect(drive.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('reads exactly eight novel situations, each with a drive', () => {
    expect(report.sketches).toHaveLength(8);
    expect(report.sketches.map(sketch => sketch.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const sketch of report.sketches) expect(sketch.drive.length).toBeGreaterThan(0);
  });

  it('reads the three warm-up stages in order', () => {
    expect(report.warmUp.every(stage => stage.length > 0)).toBe(true);
    expect(report.warmUp[0]).toContain('Short, even, low emoji');
  });

  it('keeps only generic exemplars in the pool', () => {
    expect(report.pool.length).toBeGreaterThanOrEqual(8);
    expect(report.pool.every(exemplar => exemplar.specificity === 'generic')).toBe(true);
  });

  it('rejects a drive that cites only one source', () => {
    const broken = fixture.replace('sources: chat-1 sometimes, chat-2 often', 'sources: chat-1 sometimes');
    expect(() => parseReport(broken)).toThrow();
  });
});
