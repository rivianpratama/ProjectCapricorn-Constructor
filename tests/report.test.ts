import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Models write the prompt's H2 sections back in whatever shape they please. Every one of these
 * is the same report, and a shape the parser refuses costs a whole two-minute generation.
 */
describe('parseReport tolerates heading shapes', () => {
  const shapes: Record<string, string> = {
    'H1 instead of H2': fixture.replace(/^## /gm, '# '),
    'H3 instead of H2': fixture.replace(/^## /gm, '### '),
    'H6 instead of H2': fixture.replace(/^## /gm, '###### '),
    'bold headings': fixture.replace(/^## (\d+\..+)$/gm, '**$1**'),
    'bold headings with a colon': fixture.replace(/^## (\d+\..+)$/gm, '**$1:**'),
    'indented headings': fixture.replace(/^## /gm, '   ## '),
    'CRLF line endings': fixture.replace(/\n/g, '\r\n'),
    'a fenced document': '```markdown\n' + fixture + '\n```',
    'a reasoning block in front': ' thinkingI should plan this first.</think>\n\n' + fixture,
  };

  for (const [name, markdown] of Object.entries(shapes)) {
    it(name, () => {
      expect(parseReport(markdown).sections['1. Trait ledger']).toContain('taken-seriously');
    });
  }

  it('keeps a numbered list inside a section out of the structure', () => {
    const markdown = fixture
      .replace('## 8. Novel situations', '## 8. Novel situations')
      .replace(/^1\. A friend cancels/gm, '1. A friend cancels');
    const report = parseReport(markdown);
    expect(Object.keys(report.sections).filter(key => /^\d+\. /.test(key))).toHaveLength(11);
  });

  it('does not let a bold label or a fenced example split a section', () => {
    const markdown = fixture.replace(
      '## 2. Inheritance',
      '## 2. Inheritance\n\n**1. Not a section**\n\n```markdown\n## 3. Also an example\n```\n\nThen more text.',
    );
    const report = parseReport(markdown);
    expect(report.sections['2. Inheritance']).toContain('Then more text.');
  });

  it('names the headings it found, so a bad shape is readable', () => {
    const markdown = fixture.replace(/^## \d+\. /gm, '## ');
    expect(() => parseReport(markdown)).toThrow(/report needs 11 sections, found \d+, no numbered headings|report needs 11 sections, found \d+ \(/);
  });
});

describe('parseReport refuses a section that carries decisions', () => {
  it('names an empty Life facts section instead of letting the memory forge proceed on nothing', () => {
    const empty = fixture.replace(/(## 10\. Life facts\n)[\s\S]*?(?=## 11\.)/, '$1\n');
    expect(() => parseReport(empty)).toThrow(/section "## 10\. Life facts" is empty/);
  });

  it('still accepts a section that carries its own structure', () => {
    expect(parseReport(fixture).sections['10. Life facts']).toContain('fact:');
  });
});

describe('parseReport tolerates line shapes', () => {
  it('reads ledger rows that lost their bullet', () => {
    const report = parseReport(fixture.replace(/^- id: /gm, 'id: '));
    expect(report.ledger).toHaveLength(3);
  });

  it('reads red-thread drives written with any bullet', () => {
    const report = parseReport(fixture.replace(/^- id: /gm, '* id: '));
    expect(report.drives).toHaveLength(4);
    expect(report.ledger).toHaveLength(3);
  });
});

describe('parseReport reads the warm-up stages loosely', () => {
  const withArc = (block: string) => fixture.replace(/^## 5\. Warm-up arc[\s\S]*?(?=^## 6\.)/m, `## 5. Warm-up arc\n\n${block}\n\n`);

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('accepts a label and prose on separate lines with a colon', () => {
    const report = parseReport(
      withArc('**stranger:** Short.\nMore.\n\n**familiar:** Warmer.\n\n**close:** Warmest, and it teases.'),
    );
    expect(report.warmUp).toEqual(['Short. More.', 'Warmer.', 'Warmest, and it teases.']);
  });

  it('accepts lowercase or capitalised labels, list markers and H3 labels', () => {
    const report = parseReport(withArc('### Stranger\nOpens flat.\n\n- **familiar** Picks up the thread.\n\n**CLOSE** Jokes.'));
    expect(report.warmUp).toEqual(['Opens flat.', 'Picks up the thread.', 'Jokes.']);
  });

  it('still rejects a missing stage, and says which', () => {
    expect(() => parseReport(withArc('**stranger:** Short.\n\n**close:** Warm.'))).toThrow(/warmUp\.1: Too small/);
  });
});
