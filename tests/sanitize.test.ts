import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/lib/soul/pack';
import { parseSoul, renderSoul } from '../src/lib/soul/parseSoul';
import { numberWords, sanitizeSoul, spellDigits } from '../src/lib/soul/sanitize';

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'soul.md'), 'utf8');

describe('spellDigits', () => {
  it('writes numbers as words', () => {
    expect(numberWords('0')).toBe('zero');
    expect(numberWords('21')).toBe('twenty one');
    expect(numberWords('120')).toBe('one hundred twenty');
    expect(numberWords('2500')).toBe('two thousand five hundred');
    expect(spellDigits('at 2am, 3.5 times, the 1st, 50% sure')).toBe('at two am, three point five times, the first, fifty percent sure');
    expect(spellDigits('call 08123456789')).toMatch(/^call zero eight/);
    expect(spellDigits('a1 b22')).not.toMatch(/\d/);
  });
});

describe('sanitizeSoul', () => {
  it('leaves a clean soul byte for byte', () => {
    const result = sanitizeSoul(fixture);
    expect(result.changed).toBe(false);
    expect(result.markdown).toBe(fixture);
  });

  it('clears the digit, dash, colon and duplicate slips that fail the lints', () => {
    const slipped = fixture
      .replace('You are Iris.', 'You are Iris, 21, and you text at 2am — mostly.')
      .replace(/(## web\.persona\n\n```text\n[^\n]*\n\n)/, '$1Her rule: be brief; however, never cold.\n\n');
    const soul = parseSoul(slipped);
    expect(buildPack(soul, slipped).issues.length).toBeGreaterThan(0);

    const fixed = sanitizeSoul(slipped);
    expect(fixed.changed).toBe(true);
    const pack = buildPack(parseSoul(fixed.markdown), fixed.markdown);
    expect(pack.issues).toEqual([]);
    expect(parseSoul(fixed.markdown)['iris.persona']).toContain('twenty one');
  });

  it('repairs a wrong opening line and keeps the rest', () => {
    const wrong = fixture.replace(/^## Who you are/m, '## Who you are now');
    const fixed = sanitizeSoul(wrong);
    expect(parseSoul(fixed.markdown)['web.persona'].startsWith('## Who you are\n')).toBe(true);
  });

  it('drops duplicate and oversized pool items', () => {
    const soul = parseSoul(fixture);
    const stretch = [...soul.pools.stretch, soul.pools.stretch[0], ...Array.from({ length: 30 }, (_, i) => `soo${'o'.repeat(i)}`)];
    const text = renderSoul({ ...soul, pools: { ...soul.pools, stretch } });
    const pools = parseSoul(sanitizeSoul(text).markdown).pools;
    expect(pools.stretch.length).toBeLessThanOrEqual(24);
    expect(new Set(pools.stretch).size).toBe(pools.stretch.length);
  });

  it('hands back text that will not parse untouched', () => {
    const text = '@@ I.P03 replace\nnew paragraph';
    expect(sanitizeSoul(text)).toEqual({ markdown: text, changed: false });
  });
});
