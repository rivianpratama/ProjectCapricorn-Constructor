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
  // A slot ends only where the next slot begins. The persona's own headings (`## Who you are`, the
  // opening line a host app requires) are content, whether the composer fenced the slot or not, and
  // a nested fence inside a slot must not hide the next slot's heading.
  const headings = [...text.matchAll(/^[ \t]*#{2,3}[ \t]+(.+?)[ \t]*$|^[ \t]*\*\*(.+?)\*\*:?[ \t]*$/gm)]
    .map(match => ({ match, name: slotName(match[1] ?? match[2] ?? '') }))
    .filter(({ name }) => name === 'Changelog' || SOUL_SLOTS.includes(name as SoulSlot));
  const body: Record<string, string> = {};

  for (let i = 0; i < headings.length; i++) {
    const { match, name } = headings[i];
    if (name === 'Changelog') continue;
    const from = (match.index ?? 0) + match[0].length;
    const to = headings[i + 1]?.match.index ?? text.length;
    // The first heading for a slot wins; a stray repeat later in the text does not replace it.
    if (!body[name]) body[name] = text.slice(from, to).trim();
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

/**
 * A slot heading however the composer writes it: `## iris.how`, `### iris.how`, `## 2. iris.how`,
 * `**iris.how**` or `## iris how`. The slot is its `target.name` id, not whatever markup surrounds it.
 */
function slotName(heading: string): string {
  const text = heading
    .replace(/^[*_#`\s]+/, '')
    .replace(/[ *_#:`]+$/, '')
    .trim();
  const numbered = text.replace(/^\d+[.)]\s*/, '');
  const exact = SOUL_SLOTS.find(slot => slot === numbered);
  if (exact) return exact;
  const spaced = numbered.replace(/\s+/g, '').toLowerCase();
  return SOUL_SLOTS.find(slot => slot.replace('.', '') === spaced) ?? numbered;
}

/**
 * The prose inside a slot. A fenced slot is returned exactly as fenced (its own headings are
 * the persona's, not markup). An unfenced one loses the heading it was copied under, if any.
 */
function unfence(value: string): string {
  const fence = value.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) return fence[1].trim();
  const first = value.match(/^(?:#{1,6}[ \t]+([^\n]*)|\*\*([^\n]+?)\*\*:?)[ \t]*\n+/);
  // Only a heading that merely repeats the slot id is dropped. `## Who you are` is the slot's own opening.
  if (first && SOUL_SLOTS.includes(slotName(first[1] ?? first[2] ?? '') as SoulSlot)) return value.slice(first[0].length).trim();
  return value.trim();
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
