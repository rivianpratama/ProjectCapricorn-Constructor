import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTail, jsonAnchor, pick, stripTags, tailSources } from '../src/lib/fidelity/tail';
import { baselinePath, readAdapter } from '../src/lib/soul/slots';

const snapshot = baselinePath(readAdapter().targets['irises-web']);
const source = readFileSync(join(snapshot, 'src/worker/prompt/tail.ts'), 'utf8');

const input = {
  clockLabel: '21:04',
  tz: 'Asia/Jakarta',
  directiveLines: ['mood amused, mask on'],
  looseness: 2 as const,
  bubbleCap: 2 as const,
  quietForced: false,
  safety: false,
  firstTurn: true,
  voiceSeed: 1264,
  text: 'so how was the thing',
};

describe('tail port', () => {
  it('strips the fence tags the snapshot strips', () => {
    expect(stripTags('<prompt>hi</prompt>')).toBe('hi');
    expect(stripTags('<their_message x="1">a</their_message>')).toBe('a');
    expect(stripTags('<prompt mean in html? x > y')).toBe('prompt mean in html? x > y');
  });

  it('uses the snapshot pick, which is deterministic and distinct', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const first = pick(pool, 4, 1264);
    expect(first).toEqual(pick(pool, 4, 1264));
    expect(new Set(first).size).toBe(4);
  });

  it('reads the drift lines out of the snapshot rather than inventing them', () => {
    const sources = tailSources();
    expect(sources.common).toHaveLength(4);
    expect(sources.common.join(' ')).not.toContain('real trouble');
    expect(sources.law.general.length).toBeGreaterThanOrEqual(2);
    expect(sources.law.quiet.length).toBeGreaterThanOrEqual(2);
    expect(sources.law.careful.length).toBeGreaterThanOrEqual(2);
    expect(sources.firstTurn).toContain('test you');
    expect(source).toContain(sources.common[0]);
  });

  it('frames a turn with both prompt blocks and the message between them', () => {
    const tail = buildTail(input, {});
    expect(tail.startsWith('<prompt>\n')).toBe(true);
    expect(tail).toContain('<their_message>so how was the thing</their_message>');
    expect(tail).toContain("## Right now\nIt's 21.04 for them (Asia/Jakarta).");
    expect(tail).toContain('## Their first message\nThis is the first thing they ever sent you');
    expect(tail).toContain('Your English this turn is loose. At most 2 bubbles.');
    expect(tail).toContain('## Still the same Irises, this far down');
    expect(tail.endsWith(jsonAnchor(2))).toBe(true);
  });

  it('keeps no colon in the prompt text it frames', () => {
    const framed = buildTail(input, {}).split('<their_message>')[0];
    expect(framed).not.toMatch(/[:：]/);
  });

  it('switches the law when the turn is quiet or careful', () => {
    expect(buildTail({ ...input, quietForced: true }, {})).toContain('Stay quiet this turn');
    const careful = buildTail({ ...input, safety: true }, {});
    expect(careful).toContain('## Careful');
    expect(careful).not.toContain('## This turn');
  });

  it('frames the Try room as a first meeting, never a demo to install', () => {
    const tail = buildTail({ ...input, directiveLines: [], lastCredit: true }, {});
    expect(tail).not.toMatch(/demo|install|github|being tested|test you/i);
  });
});
