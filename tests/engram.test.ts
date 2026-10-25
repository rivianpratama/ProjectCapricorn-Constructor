import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGRAIN_SECTIONS, parseEngram, parseEngramDetailed } from '../src/lib/schema/engram';

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

  it('supports curly quotes, single quotes, and backticks in findings', () => {
    const custom = fixture
      .replace(
        'quotes: "it was so good" "i got the weird menu thing"',
        'quotes: “it was so good” ‘i got the weird menu thing’',
      )
      .replace('quotes: "wkwk fair"', 'quotes: `wkwk fair`');
    const parsed = parseEngram(custom, 'chat-1');
    const bubble = parsed.findings.find(f => f.id === 'bubble-split');
    expect(bubble?.quotes).toEqual(['it was so good', 'i got the weird menu thing']);
    const laugh = parsed.findings.find(f => f.id === 'laugh-token');
    expect(laugh?.quotes).toEqual(['wkwk fair']);
  });

  it('supports markdown wrapped in codeblock fences, H1 headings, and H3 headings', () => {
    const fenced = `\`\`\`markdown\n${fixture}\n\`\`\``;
    const parsedFenced = parseEngram(fenced, 'chat-1');
    expect(Object.keys(parsedFenced.sections)).toEqual(ENGRAIN_SECTIONS.map((name, i) => `${i + 1}. ${name}`));

    const h1Doc = fixture.replace(/^## /gm, '# ');
    const parsedH1 = parseEngram(h1Doc, 'chat-1');
    expect(Object.keys(parsedH1.sections)).toEqual(ENGRAIN_SECTIONS.map((name, i) => `${i + 1}. ${name}`));

    const h3Doc = fixture.replace(/^## /gm, '### ');
    const parsedH3 = parseEngram(h3Doc, 'chat-1');
    expect(Object.keys(parsedH3.sections)).toEqual(ENGRAIN_SECTIONS.map((name, i) => `${i + 1}. ${name}`));
  });
});

describe('parseEngramDetailed', () => {
  const block = (body: string) => fixture.replace(/^## 10\. Exemplars[\s\S]*?(?=^## 11\.)/m, `## 10. Exemplars\n${body}\n\n`);

  it('keeps exemplars whose head line carries a speaker label', () => {
    const labelled = fixture.replace(/^\[(.+?)\] -> \[(.+?)\]$/gm, 'Bima: [$1] -> [$2]');
    expect(parseEngram(labelled).exemplars).toHaveLength(parseEngram(fixture).exemplars.length);
  });

  it('keeps exemplars with no brackets at all, right above their tags line', () => {
    const bare = fixture.replace(/^\[(.+?)\] -> \[(.+?)\]$/gm, '$1 -> $2');
    const exemplars = parseEngram(bare).exemplars;
    expect(exemplars).toHaveLength(parseEngram(fixture).exemplars.length);
    expect(exemplars[0].stimulus).not.toContain('->');
  });

  it('reads prose with an arrow as prose, not an exemplar', () => {
    const prose = fixture.replace('## 9. Context-specific (the overfit fence)', '## 9. Context-specific (the overfit fence)\nThe plan -> the rent.');
    expect(parseEngram(prose).exemplars).toHaveLength(parseEngram(fixture).exemplars.length);
  });

  it('says why a finding line was dropped instead of dropping it silently', () => {
    const broken = fixture.replace('- id: laugh-token, frequency: often, scope: across topics, confidence: high, ', '- id: laugh-token, ');
    const { findings } = parseEngramDetailed(broken, 'chat-1');
    expect(findings.rejected).toHaveLength(1);
    expect(findings.rejected[0].reason).toBe('finding has no usable scope, frequency, confidence');
  });

  it('ignores lines that only start with "id" as prose', () => {
    const prose = fixture.replace('## 4. Emotion', '## 4. Emotion\n- id: kiara, this is a sentence about her');
    const { findings } = parseEngramDetailed(prose, 'chat-1');
    expect(findings.rejected).toHaveLength(0);
    expect(findings.kept).toBe(parseEngram(prose, 'chat-1').findings.length);
  });

  it('collects the searches behind a Not observed receipt', () => {
    const receipt = fixture.replace('## 4. Emotion', '## 4. Emotion\nNot observed (searched: "sih", "dong").');
    const { findings } = parseEngramDetailed(receipt, 'chat-1');
    expect(findings.receipts).toContain('"sih", "dong"');
  });
});
