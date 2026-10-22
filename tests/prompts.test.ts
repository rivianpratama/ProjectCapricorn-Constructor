import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGRAIN_SECTIONS } from '../src/lib/schema/engram';
import { REPORT_SECTIONS } from '../src/lib/schema/report';

const read = (name: string) => readFileSync(join(import.meta.dirname, '..', 'prompts', `${name}.md`), 'utf8');

describe('phase 1 prompt', () => {
  const text = read('phase1');

  it('names every required section in order', () => {
    let cursor = 0;
    for (const [i, section] of ENGRAIN_SECTIONS.entries()) {
      const heading = `## ${i + 1}. ${section}`;
      const at = text.indexOf(heading, cursor);
      expect(at, heading).toBeGreaterThan(-1);
      cursor = at;
    }
  });

  it('carries the evidence contract', () => {
    for (const phrase of ['verbatim quotes', 'frequency', 'scope', 'confidence', 'Not observed', 'Inference:']) {
      expect(text).toContain(phrase);
    }
  });

  it('keeps quirks out and the fence in', () => {
    expect(text).toContain('overfit');
    expect(text).toContain('quirk');
  });

  it('does not force length or forbid honesty', () => {
    expect(text).not.toMatch(/exhaust|token limit|never say|insufficient data/i);
    expect(text).not.toMatch(/mandatory (point|bullet|item)/i);
  });
});

describe('phase 2 prompt', () => {
  const text = read('phase2');

  it('names every report section in order', () => {
    let cursor = 0;
    for (const [i, section] of REPORT_SECTIONS.entries()) {
      const heading = `## ${i + 1}. ${section}`;
      const at = text.indexOf(heading, cursor);
      expect(at, heading).toBeGreaterThan(-1);
      cursor = at;
    }
  });

  it('states the child rule and the novelty rule', () => {
    expect(text.toLowerCase()).toContain('child');
    expect(text.toLowerCase()).toContain('novel');
  });

  it('does not carry forensic framing', () => {
    expect(text).not.toMatch(/deception|exploitab|SCAN|tactical engagement/i);
  });
});

describe('phase 3a prompt', () => {
  const text = read('phase3a');

  it('names the fixed items and the four trait options', () => {
    for (const id of ['name', 'nicknames', 'relationship', 'language', 'life_facts', 'energy', 'rename']) {
      expect(text).toContain('`' + id + '`');
    }
    expect(text).toContain('Keep, Soften, Only once close, Remove');
  });

  it('keeps the always-on subjects out', () => {
    expect(text).toContain('Never ask about safety');
    expect(text).toContain('third-party names');
  });
});

describe('phase 3b prompt', () => {
  const text = read('phase3b');

  it('preserves the machinery and the anchor headings', () => {
    for (const phrase of ['precedence', 'four turn kinds', 'mood and mask', 'AI', '## Who is typing, in every lane', '## Who you are', '## How you write']) {
      expect(text).toContain(phrase);
    }
  });

  it('carries the prose bans', () => {
    expect(text).toContain('Behaviour, not adjectives');
    expect(text).toContain('No em dashes');
    expect(text).toContain('however');
  });

  it('names every slot in output order', () => {
    let cursor = 0;
    for (const slot of ['iris.persona', 'iris.how', 'iris.language', 'iris.banter', 'web.persona', 'web.how', 'samples', 'stretch', 'punct']) {
      const at = text.indexOf('`' + slot + '`', cursor);
      expect(at, slot).toBeGreaterThan(-1);
      cursor = at;
    }
  });
});
