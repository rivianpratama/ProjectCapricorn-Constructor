import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/lib/soul/pack';
import { parseSoul } from '../src/lib/soul/parseSoul';
import { baselinePath, readAdapter } from '../src/lib/soul/slots';

const soulMarkdown = readFileSync(join(import.meta.dirname, 'fixtures', 'soul.md'), 'utf8');
const soul = parseSoul(soulMarkdown);
const report = '# ENGRAM\n\n## 1. Trait ledger\n\n- id: quiet-anger\n';
const pack = buildPack(soul, soulMarkdown, { n: 2, report, targetShas: { irises: '0fe1d67', 'irises-web': 'd2b3f03' } });
const byPath = new Map(pack.files.map(file => [file.path, file.source]));

const EXPECTED = [
  'soul-pack/irises/src/persona/policy.ts',
  'soul-pack/irises/src/persona/voiceSamples.ts',
  'soul-pack/irises/src/agents/convo/Context.md',
  'soul-pack/irises-web/src/worker/prompt/persona.ts',
  'soul-pack/irises-web/src/worker/prompt/voice.ts',
  'soul-pack/SOUL.md',
  'soul-pack/ENGRAM_REPORT.md',
  'soul-pack/APPLY.md',
];

describe('buildPack', () => {
  it('renders every pack file', () => {
    for (const path of EXPECTED) expect(byPath.has(path), path).toBe(true);
  });

  it('keeps SOUL.md verbatim', () => {
    expect(byPath.get('soul-pack/SOUL.md')).toBe(soulMarkdown);
  });

  it('ships the report beside the soul', () => {
    expect(byPath.get('soul-pack/ENGRAM_REPORT.md')).toBe(report);
  });

  it('writes the persona text into the web persona file and nothing else', () => {
    const rendered = byPath.get('soul-pack/irises-web/src/worker/prompt/persona.ts')!;
    expect(rendered).toContain(soul['web.persona']);
    expect(rendered).toContain(soul['web.how']);
    expect(rendered).toContain('export const PERSONA = `');
    expect(rendered).toContain('export const HOW_YOU_WRITE = `');
  });

  it('changes only the pool bodies of the web voice file', () => {
    const target = readAdapter().targets['irises-web'];
    const original = readFileSync(join(baselinePath(target), 'src/worker/prompt/voice.ts'), 'utf8');
    const rendered = byPath.get('soul-pack/irises-web/src/worker/prompt/voice.ts')!;
    for (const machinery of ['export const SAMPLE_COUNT', 'export function pick', 'export function voiceSamplesFor', 'function gcd']) {
      expect(rendered).toContain(machinery);
      expect(original).toContain(machinery);
    }
    const tail = (text: string) => text.slice(text.indexOf('export const SAMPLE_COUNT'));
    expect(tail(rendered)).toBe(tail(original));
    expect(rendered).not.toBe(original);
  });

  it('keeps the machinery exports of the Irises files', () => {
    const policy = byPath.get('soul-pack/irises/src/persona/policy.ts')!;
    expect(policy).toContain('export const PERSONA_BLOCK = `');
    const samples = byPath.get('soul-pack/irises/src/persona/voiceSamples.ts')!;
    expect(samples).toContain('export function voiceSamplesFor');
    expect(samples).toContain('export const SAMPLE_REPLIES');
  });

  it('renders the persona text into the Irises context file', () => {
    const context = byPath.get('soul-pack/irises/src/agents/convo/Context.md')!;
    expect(context).toContain('## How you write (strict, this matters)');
    expect(context).toContain('## Language');
    expect(context).toContain('**Banter — the play frame.**');
  });

  it('writes APPLY.md with the copy table and the changelog', () => {
    const apply = byPath.get('soul-pack/APPLY.md')!;
    expect(apply).toContain('| `soul-pack/irises-web/src/worker/prompt/persona.ts` | `IrisesWeb/src/worker/prompt/persona.ts` |');
    expect(apply).toContain('against Irises `0fe1d67` and IrisesWeb `d2b3f03`');
    expect(apply).toContain('Built from 2 chats');
    expect(apply).toContain('- Identity now runs on two drives');
    expect(apply).toContain('personaModules.test.ts');
    expect(apply).toContain('Jakarta');
  });

  it('reports no lint issues for a clean soul', () => {
    expect(pack.issues).toEqual([]);
    expect(pack.poolIssues).toEqual([]);
  });

  it('flags a digit and a placeholder in a slot', () => {
    const dirty = { ...soul, 'web.persona': 'You are 1 friend, {name}.' };
    const built = buildPack(dirty as typeof soul, soulMarkdown);
    const rules = built.issues.map(issue => issue.rule);
    expect(rules).toContain('no-digit');
    expect(rules).toContain('no-placeholder');
  });

  it('flags a pool that is too small', () => {
    const thin = { ...soul, pools: { ...soul.pools, punct: ['??'] } };
    const built = buildPack(thin as typeof soul, soulMarkdown);
    expect(built.poolIssues.some(issue => issue.pool === 'punct' && issue.detail.includes('at least 12'))).toBe(true);
  });
});
