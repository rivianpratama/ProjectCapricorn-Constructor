import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { poolExport, toJsonArray } from '../src/lib/fidelity/irisesweb';
import { baselinePath, readAdapter } from '../src/lib/soul/slots';

const voice = readFileSync(
  join(baselinePath(readAdapter().targets['irises-web']), 'src/worker/prompt/voice.ts'),
  'utf8',
);

describe('poolExport', () => {
  it('reads a snapshot pool with single quotes and escaped quotes', () => {
    const samples = poolExport(voice, 'SAMPLE_REPLIES') as string[][];
    expect(samples.length).toBeGreaterThanOrEqual(12);
    expect(samples.every(row => Array.isArray(row) && row.length >= 1)).toBe(true);
    expect(samples.flat().some(bubble => bubble.includes("'"))).toBe(true);
  });

  it('reads the string pools', () => {
    expect((poolExport(voice, 'STRETCH_WORDS') as string[]).length).toBeGreaterThanOrEqual(12);
    expect((poolExport(voice, 'PUNCT_RUNS') as string[]).length).toBeGreaterThanOrEqual(12);
  });

  it('drops line comments and trailing commas', () => {
    expect(JSON.parse(toJsonArray("\n  ['a', 'b'], // a note\n  ['c'],\n"))).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps a double quote inside a single-quoted string', () => {
    expect(toJsonArray("\n  ['he said \"hi\"'],\n")).toBe('[\n  ["he said \\"hi\\""]]');
  });

  it('rejects a pool that is not there', () => {
    expect(() => poolExport(voice, 'NOPE')).toThrow(/no pool NOPE/);
  });
});
