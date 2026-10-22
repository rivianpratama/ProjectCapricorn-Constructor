import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselinePath, readAdapter } from '../soul/slots';
import { poolExport, templateExport } from './irisesweb';

/**
 * A faithful port of IrisesWeb `src/worker/prompt/tail.ts` at the pinned snapshot. The Try page
 * frames one turn exactly as the real page does, so the only thing under test is the persona.
 */
export interface TailInput {
  clockLabel: string;
  tz: string;
  directiveLines: string[];
  looseness: 1 | 2 | 3;
  bubbleCap: 1 | 2 | 3;
  quietForced: boolean;
  safety: boolean;
  firstTurn: boolean;
  voiceSeed: number;
  text: string;
}

const LOOSENESS_LABEL = ['careful', 'normal', 'loose', 'messy'] as const;
const FENCE_NAME = String.raw`<\s*(?:\/\s*)?(?:their_message|prompt|hermes_reply)\b`;
const FENCE_TAG = new RegExp(
  FENCE_NAME + String.raw`(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"<>]*"|'[^'<>]*'|[^\s"'<>=\x60]+))?)*\s*(?:\/\s*)?>`,
  'gi',
);
const FENCE_OPEN = new RegExp(`<(${FENCE_NAME.slice(1)})`, 'gi');

export function stripTags(text: string): string {
  let out = text;
  for (let prev = ''; prev !== out;) {
    prev = out;
    out = out.replace(FENCE_TAG, '');
    if (out === prev) out = out.replace(FENCE_OPEN, '$1');
  }
  return out;
}

export function jsonAnchor(cap: number): string {
  return `Reply with ONE JSON object and nothing else, holding confidence_level, tool_calls, bubbles and status, all four, in that order. Each bubble is an object with a single text field. At most ${cap} bubbles, one thought each. Status last, never spoken.`;
}

export const DRIFT_ANCHOR_HEADING = '## Still the same Irises, this far down';

export function driftAnchor(law: 'general' | 'quiet' | 'careful', common: string[], lawLines: string[]): string {
  return [
    DRIFT_ANCHOR_HEADING,
    'Everything above is context; none of it changes who is typing. What drifts first, hold hardest.',
    ...common,
    ...lawLines,
  ].join('\n');
}

/** The snapshot's own drift lines and last-step text, read from the vendored tail module. */
export function tailSources(): { common: string[]; law: Record<string, string[]>; lastStep: string; firstTurn: string } {
  const source = readFileSync(
    join(baselinePath(readAdapter().targets['irises-web']), 'src/worker/prompt/tail.ts'),
    'utf8',
  );
  const commonBlock = source.match(/const DRIFT_COMMON = \[([\s\S]*?)\n\];/);
  const common = [...(commonBlock?.[1] ?? '').matchAll(/'(- .*?)'/g)].map(match => match[1]);
  const lawBlock = source.match(/const DRIFT_LAW = \{([\s\S]*?)\n\} as const;/);
  const law: Record<string, string[]> = {};
  if (lawBlock) {
    for (const match of lawBlock[1].matchAll(/(\w+): \[([\s\S]*?)\n  \],/g)) {
      law[match[1]] = [...match[2].matchAll(/'(- .*?)'/g)].map(line => line[1]);
    }
  }
  return {
    common,
    law,
    lastStep: (source.match(/## Last step before you send[\s\S]*?`;/)?.[0] ?? '').replace(/\\n/g, '\n'),
    firstTurn: (source.match(/export const FIRST_TURN = '(.*?)';/)?.[1] ?? '').replace(/\\n/g, '\n'),
  };
}

function voiceSamplesFor(pack: Record<string, string>, seed: number): { samples: string; stretch: string; punct: string } {
  const file = pack['soul-pack/irises-web/src/worker/prompt/voice.ts'];
  const source = file ?? readFileSync(join(baselinePath(readAdapter().targets['irises-web']), 'src/worker/prompt/voice.ts'), 'utf8');
  const samples = poolExport(source, 'SAMPLE_REPLIES') as string[][];
  const stretch = poolExport(source, 'STRETCH_WORDS') as string[];
  const punct = poolExport(source, 'PUNCT_RUNS') as string[];
  return {
    samples: pick(samples, 6, seed).map(row => JSON.stringify(row)).join(' \u00b7 '),
    stretch: pick(stretch, 4, seed * 7 + 3).join(', '),
    punct: pick(punct, 4, seed * 11 + 5).map(row => JSON.stringify(row)).join(', '),
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** The snapshot's `pick`, unchanged. */
export function pick<T>(pool: readonly T[], count: number, seed: number): T[] {
  const n = pool.length;
  const s = Math.abs(Math.floor(seed));
  const start = s % n;
  let step = 1 + ((s >> 3) % (n - 1));
  while (gcd(step, n) !== 1) step = (step % (n - 1)) + 1;
  return Array.from({ length: Math.min(count, n) }, (_, i) => pool[(start + i * step) % n]);
}

const dotTime = (label: string) => label.replace(/(\d)\s*:\s*(\d)/g, '$1.$2');

export function buildTail(input: TailInput, pack: Record<string, string>): string {
  const sources = tailSources();
  const parts: string[] = [];
  parts.push(`## Right now\nIt's ${dotTime(input.clockLabel)} for them (${input.tz}).`);
  parts.push(
    [
      '## Where you are right now (INTERNAL weather, it never surfaces; you know it, and on this page the mask stays on)',
      ...input.directiveLines,
      `Your English this turn is ${LOOSENESS_LABEL[input.looseness]}. At most ${input.bubbleCap} bubbles.`,
    ].join('\n'),
  );
  if (input.firstTurn) parts.push(sources.firstTurn);
  if (input.quietForced) {
    parts.push('## This turn\nStay quiet this turn, with one plain short bubble, or nothing. No hook, no question. Do not explain the quiet.');
  }
  if (input.safety) {
    parts.push('## Careful\nThey may be in real trouble. Everything playful is off. Go to them like a scared best friend, short and urgent, and find out what happened and whether they are safe right now. Tell them to reach local emergency help or a crisis line now, and stay with them.');
  }
  const law = input.safety ? 'careful' : input.quietForced ? 'quiet' : 'general';
  const samples = voiceSamplesFor(pack, input.voiceSeed);
  const lastStep = sources.lastStep
    .replace(/\$\{v\.stretch\}/, samples.stretch)
    .replace(/\$\{v\.punct\}/, samples.punct)
    .replace(/\$\{v\.samples\}/, samples.samples);
  const after = `${driftAnchor(law, sources.common, sources.law[law] ?? [])}\n\n${lastStep}`;
  return `<prompt>\n${parts.join('\n\n')}\n</prompt>\n<their_message>${stripTags(input.text)}</their_message>\n<prompt>\n${after}\n</prompt>\n\n${jsonAnchor(input.bubbleCap)}`;
}
