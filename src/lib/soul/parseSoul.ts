export const SOUL_SLOTS = [
  'iris.persona',
  'iris.how',
  'iris.language',
  'iris.banter',
  'web.persona',
  'web.how',
  'samples',
  'stretch',
  'punct',
] as const;

export type SoulSlot = (typeof SOUL_SLOTS)[number];
export type Pools = { samples: string[][]; stretch: string[]; punct: string[] };
export type Soul = Record<SoulSlot, string> & { pools: Pools; changelog: string[] };

const POOLS = new Set<SoulSlot>(['samples', 'stretch', 'punct']);

export function parseSoul(markdown: string): Soul {
  const text = markdown.replace(/\r\n/g, '\n').trim();
  const headings = [...text.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].filter(
    match => !insideFence(text, match.index ?? 0),
  );
  const body: Record<string, string> = {};

  for (let i = 0; i < headings.length; i++) {
    const name = headings[i][1].trim();
    if (name === 'Changelog') continue;
    if (!SOUL_SLOTS.includes(name as SoulSlot)) continue;
    const from = (headings[i].index ?? 0) + headings[i][0].length;
    const to = headings[i + 1]?.index ?? text.length;
    body[name] = text.slice(from, to).trim();
  }

  const missing = SOUL_SLOTS.filter(slot => !body[slot]);
  if (missing.length) throw new Error(`SOUL.md is missing: ${missing.join(', ')}`);

  const prose = (slot: SoulSlot) => unfence(body[slot]);

  return {
    'iris.persona': prose('iris.persona'),
    'iris.how': prose('iris.how'),
    'iris.language': prose('iris.language'),
    'iris.banter': prose('iris.banter'),
    'web.persona': prose('web.persona'),
    'web.how': prose('web.how'),
    samples: body.samples,
    stretch: body.stretch,
    punct: body.punct,
    pools: {
      samples: pool(body.samples, 'samples') as string[][],
      stretch: pool(body.stretch, 'stretch') as string[],
      punct: pool(body.punct, 'punct') as string[],
    },
    changelog: changelog(text),
  };
}

/** True when the offset sits inside a fenced code block. */
function insideFence(text: string, offset: number): boolean {
  let open = false;
  for (const line of text.slice(0, offset).split('\n')) {
    if (/^\s*```/.test(line)) open = !open;
  }
  return open;
}

function unfence(value: string): string {
  const fence = value.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  return (fence ? fence[1] : value).trim();
}

function pool(value: string, name: string): unknown {
  const fenced = value.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const raw = (fenced ? fenced[1] : value).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${name} must be an array`);
  return parsed;
}

function changelog(text: string): string[] {
  const at = text.search(/^##\s+Changelog\s*$/m);
  if (at < 0) return [];
  return text
    .slice(at)
    .split('\n')
    .slice(1)
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line && !line.startsWith('---'));
}

/** One slot's pool as its own fenced block, the way the composer emits it. */
export function soulFence(value: string[] | string[][]): string {
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

/** The whole SOUL.md body: one H2 per slot, prose fenced as text, pools fenced as json. */
export function renderSoul(soul: Omit<Soul, 'changelog'> & { changelog?: string[] }): string {
  const prose = (slot: SoulSlot) => `## ${slot}\n\n\`\`\`text\n${soul[slot].trim()}\n\`\`\``;
  const pools = soul.pools;
  return [
    prose('iris.persona'),
    prose('iris.how'),
    prose('iris.language'),
    prose('iris.banter'),
    prose('web.persona'),
    prose('web.how'),
    `## samples\n\n${soulFence(pools.samples)}`,
    `## stretch\n\n${soulFence(pools.stretch)}`,
    `## punct\n\n${soulFence(pools.punct)}`,
    '---',
    `## Changelog\n\n${(soul.changelog ?? []).map(line => `- ${line}`).join('\n')}`,
  ].join('\n\n') + '\n';
}
