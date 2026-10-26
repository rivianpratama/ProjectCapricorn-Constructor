import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUL_SLOTS, parseSoul, renderSoul, soulFence } from '../src/lib/soul/parseSoul';

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'soul.md'), 'utf8');

describe('parseSoul', () => {
  const soul = parseSoul(fixture);

  it('reads every slot in the contract order', () => {
    for (const slot of SOUL_SLOTS) expect(soul[slot]).toBeTruthy();
  });

  it('unfences prose slots and keeps their inner headings', () => {
    expect(soul['iris.how']).toContain('## How you write (strict, this matters)');
    expect(soul['iris.how']).not.toContain('```');
    expect(soul['iris.banter'].startsWith('**Banter — the play frame.**')).toBe(true);
  });

  it('reads the three pools', () => {
    expect(soul.pools.samples).toHaveLength(12);
    expect(soul.pools.samples[0]).toEqual(['it was so good', 'i got the weird menu thing']);
    expect(soul.pools.stretch.slice(0, 3)).toEqual(['soooo', 'reaaally', 'yesss']);
    expect(soul.pools.punct.slice(0, 3)).toEqual(['??', '...', '!!']);
  });

  it('reads the changelog without the rule or bullets', () => {
    expect(soul.changelog).toHaveLength(3);
    expect(soul.changelog[0]).toBe('Identity now runs on two drives instead of a list of adjectives.');
  });

  it('rejects a soul with a missing slot', () => {
    const broken = fixture.replace(/## punct[\s\S]*?(?=---)/, '');
    expect(() => parseSoul(broken)).toThrow(/missing: punct/);
  });

  it('rejects a pool that is not JSON', () => {
    const broken = fixture.replace(/\["\?\?", "\.\.\.", "!!"[\s\S]*?\]/, 'not json');
    expect(() => parseSoul(broken)).toThrow(/punct is not valid JSON/);
  });

  it('round-trips the pools through soulFence', () => {
    const rebuilt = [
      '## samples',
      '',
      soulFence(soul.pools.samples),
      '',
      '## stretch',
      '',
      soulFence(soul.pools.stretch),
      '',
      '## punct',
      '',
      soulFence(soul.pools.punct),
      '',
    ].join('\n');
    const again = parseSoul(fixture.replace(/## samples[\s\S]*?(?=---)/, rebuilt));
    expect(again.pools).toEqual(soul.pools);
  });

  it('renders a soul back out of its parsed slots', () => {
    const rebuilt = renderSoul({ ...soul, changelog: soul.changelog });
    const again = parseSoul(rebuilt);
    for (const slot of ['iris.persona', 'iris.how', 'iris.language', 'iris.banter', 'web.persona', 'web.how'] as const) {
      expect(again[slot]).toBe(soul[slot]);
    }
    expect(again.pools).toEqual(soul.pools);
    expect(again.changelog).toEqual(soul.changelog);
  });
});

describe('parseSoul heading shapes', () => {
  const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'soul.md'), 'utf8');
  const baseline = parseSoul(fixture);

  for (const [name, text] of [
    ['H3 slot headings', fixture.replace(/^## /gm, '### ')],
    ['numbered slot headings', fixture.replace(/^## (\w)/gm, '## 2. $1')],
    ['bold slot headings', fixture.replace(/^## (.+)$/gm, '**$1**')],
    ['a dropped dot in the slot id', fixture.replace(/^## iris\.how/gm, '## iris how')],
  ] as const) {
    it(`reads ${name}`, () => {
      const soul = parseSoul(text);
      // The persona's own text may carry its own headings; the slot's parse must still reach it.
      expect(soul['iris.how']).toContain('Short bubbles. Lowercase.');
      expect(soul.pools.samples).toEqual(baseline.pools.samples);
      expect(soul.pools.stretch).toEqual(baseline.pools.stretch);
    });
  }
});

describe('parseSoul unfenced slots', () => {
  const baseline = parseSoul(fixture);

  it('keeps a slot whose opening line is itself a heading', () => {
    // The composer sometimes drops the fences: `## iris.how` is then followed straight by `## How you write ...`.
    const unfenced = fixture.replace(/```text\n([\s\S]*?)\n```/g, '$1');
    const soul = parseSoul(unfenced);
    for (const slot of ['iris.persona', 'iris.how', 'iris.language', 'web.persona', 'web.how'] as const) {
      expect(soul[slot].length).toBeGreaterThan(0);
    }
    expect(soul['iris.how']).toContain('Short bubbles. Lowercase.');
    expect(soul.pools).toEqual(baseline.pools);
  });
});
