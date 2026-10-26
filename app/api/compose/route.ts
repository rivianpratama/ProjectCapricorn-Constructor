import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeLongForm, HttpError, keyFrom, modelsFrom, type Models, forRole } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { parseSoul, soulBodies, soulChangelog, SOUL_SLOTS, type Soul, type SoulSlot } from '../../../src/lib/soul/parseSoul';
import { overCopied } from '../../../src/lib/soul/lint';
import { buildPack } from '../../../src/lib/soul/pack';
import { sanitizeSoul } from '../../../src/lib/soul/sanitize';
import { baseSlots } from '../../../src/lib/soul/base';

export const runtime = 'nodejs';

interface Body {
  report: string;
  answers: Record<string, string>;
  n: number;
  /** When set, this is a revision of a soul the composer already wrote. */
  previous?: string;
  /** What to change on a revision pass. */
  fixes?: string[];
}

export async function POST(request: Request): Promise<Response> {
  return withLogging('compose', handle)(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    if (!body?.report) throw new HttpError(400, 'no report');

    const system = prompt('phase3b');
    const base = baseSlots();
    const previous = body.previous ? soulBodies(body.previous) : {};
    // One call per part, never the whole soul: a nine-slot soul plus a reasoning model's thinking
    // does not fit one output budget, and a cut-off answer wastes the whole generation. The persona
    // comes first so every later part writes the same person; the rest run side by side.
    const slots: Partial<Record<SoulSlot, string>> = {};
    let changelog: string[] = [];
    const run = async (part: Part, notes: string[] = []) => {
      const text = await compose(key, models, system, partMessage(part, body, base, slots, previous, notes), part.maxTokens);
      const got = soulBodies(text);
      for (const slot of part.slots) if (got[slot]) slots[slot] = got[slot];
      if (part.changelog) changelog = soulChangelog(text);
    };
    // A part that fails leaves its slots missing for the repair round instead of losing the others.
    const tolerant = (part: Part) => run(part).catch(error => log.warn('soul part failed; repairing it next round', { slots: part.slots, error }));
    await tolerant(PARTS[0]);
    await Promise.all(PARTS.slice(1).map(tolerant));

    const assemble = () => {
      const markdown = sanitizeSoul(joinSoul(slots, changelog)).markdown;
      return { markdown, built: build(markdown, body) };
    };
    let current = assemble();
    let best = current;
    // Three repair rounds at most, and the best soul seen wins. A round re-runs only the parts that own
    // a broken slot. A slot that kept Iris's wording gets its own paragraph-by-paragraph rewrite, since
    // a "change only this" note makes the model keep the slot and reword a few lines.
    for (let round = 0; round < 3 && current.built.problem.length > 0; round++) {
      try {
        const copied = current.built.pack ? overCopied(parseSoul(current.markdown) as unknown as Record<string, string>, base) : [];
        if (copied.length) {
          const rewritten = await transform(key, models, body, parseSoul(current.markdown), copied as SoulSlot[], base);
          Object.assign(slots, rewritten);
        } else {
          const broken = PARTS.filter(part => part.slots.some(slot => current.built.failing.has(slot)));
          await Promise.all(
            (broken.length ? broken : PARTS).map(part => {
              const notes = current.built.problem.filter(problem => part.slots.some(slot => problem.startsWith(slot)) || !broken.length);
              return run(part, notes.length ? notes : current.built.problem);
            }),
          );
        }
      } catch (error) {
        // A repair that fails to arrive must not cost the soul already in hand.
        if (!best.built.pack) throw error;
        log.warn('repair turn failed; keeping the best soul so far', { error });
        break;
      }
      current = assemble();
      if (rank(current.built) <= rank(best.built)) best = current;
    }

    // Lint issues the model could not clear are shown as warnings beside the pack, not as a failed build.
    const { markdown, built } = best;
    if (!built.pack) throw new HttpError(502, `${built.problem[0]} (after two attempts)`);
    if (built.problem.length) log.warn('soul shipped with issues', { problems: built.problem.length, first: built.problem[0] });
    const pack = built.pack;

    return Response.json({
      markdown,
      files: pack.files,
      issues: pack.issues,
      poolIssues: pack.poolIssues,
    });
  } catch (error) {
    return failed(error, 'compose failed');
  }
}

/**
 * Rewrite each over-copied slot on its own, against Iris's text for that slot. A rewrite that fails or
 * comes back nearly empty is dropped, so the slot keeps its draft.
 */
async function transform(key: string, models: Models, body: Body, soul: Soul, slots: SoulSlot[], base: Record<string, string>): Promise<Partial<Record<SoulSlot, string>>> {
  const system = prompt('phase3b-transform');
  const rewritten = await Promise.all(
    slots.map(async slot => {
      const user = [
        `Rewrite the slot \`${slot}\`. Iris's version is ${base[slot].length} characters; match that within fifteen percent.`,
        '',
        body.report,
        '',
        '## Decisions',
        ...decisions(body),
        '',
        `## Iris's ${slot}, the gold standard for depth`,
        base[slot],
        '',
        '## The current draft, too close to Iris',
        soul[slot],
      ].join('\n');
      const text = await compose(key, models, system, user, outputBudget(base[slot].length));
      const fenced = text.match(/```[a-z]*\n([\s\S]*?)\n```/i);
      return [slot, (fenced ? fenced[1] : text).trim()] as const;
    }),
  );
  return Object.fromEntries(
    rewritten.filter(([slot, text]) => text.length > base[slot].length * 0.3).map(([slot, text]) => [slot, '```text\n' + text + '\n```']),
  );
}

interface Part {
  slots: SoulSlot[];
  maxTokens: number;
  changelog?: boolean;
}

/**
 * Room for the answer plus a reasoning model's thinking. About four characters a token, doubled for
 * a language that tokenises worse, and a fixed allowance for reasoning on top.
 */
function outputBudget(chars: number): number {
  return Math.min(48_000, Math.round(chars / 2) + 24_000);
}

/** The persona first, then the rest beside each other. Each part's answer stays well inside its budget. */
const PARTS: Part[] = [
  { slots: ['iris.persona'], maxTokens: outputBudget(36_000), changelog: true },
  { slots: ['iris.how', 'iris.language', 'iris.banter'], maxTokens: outputBudget(8_000) },
  { slots: ['web.persona', 'web.how'], maxTokens: outputBudget(18_000) },
  { slots: ['samples', 'stretch', 'punct'], maxTokens: outputBudget(6_000) },
];

const decisions = (body: Body) => Object.entries(body.answers ?? {}).map(([id, answer]) => `- ${id}: ${answer}`);

/** One part's request: only the Iris slots it replaces, and the persona already written when there is one. */
function partMessage(
  part: Part,
  body: Body,
  base: Record<string, string>,
  written: Partial<Record<SoulSlot, string>>,
  previous: Partial<Record<SoulSlot, string>>,
  notes: string[],
): string {
  const own = part.slots.filter(slot => base[slot] !== undefined);
  const persona = !part.slots.includes('iris.persona') ? written['iris.persona'] : undefined;
  const draft = part.slots.filter(slot => (notes.length ? written[slot] : previous[slot]));
  return [
    `Write only these slots, in this order: ${part.slots.map(slot => `\`${slot}\``).join(', ')}. One H2 per slot, in the format the Output section gives, and nothing else.${part.changelog ? ' End with the `---` line and the changelog.' : ' No changelog.'}`,
    '',
    body.report,
    '',
    '## Decisions',
    ...decisions(body),
    ...(persona ? ['', '## The person, already written in iris.persona', 'Every slot you write is this same person, in the same language and voice.', '', persona] : []),
    ...(own.length
      ? ['', '## Iris, the gold standard', 'Reference for depth, logic and length only. Every slot you write matches its length and the number of mechanisms it carries, and shares none of its wording or persona.', '', ...own.flatMap(slot => [`### ${slot} (${base[slot].length} characters)`, base[slot], ''])]
      : []),
    ...(draft.length ? ['', '## Your current draft of these slots', ...draft.flatMap(slot => [`## ${slot}`, (notes.length ? written[slot] : previous[slot])!, ''])] : []),
    ...(notes.length || body.fixes?.length
      ? ['', '## Fix these, and keep everything they do not name', ...[...notes, ...(body.fixes ?? [])].map(note => `- ${note}`)]
      : []),
  ].join('\n');
}

/** The parts' slots back into one SOUL.md, in slot order. A missing slot is left out so the parser names it. */
function joinSoul(slots: Partial<Record<SoulSlot, string>>, changelog: string[]): string {
  return [
    ...SOUL_SLOTS.filter(slot => slots[slot]).map(slot => `## ${slot}\n\n${slots[slot]}`),
    '---',
    `## Changelog\n\n${changelog.map(line => `- ${line}`).join('\n')}`,
  ].join('\n\n') + '\n';
}

async function compose(key: string, models: Models, system: string, user: string, maxTokens: number): Promise<string> {
  return (
    await completeLongForm({
      key,
      ...forRole(models, 'strong'),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
      maxTokens,
    })
  ).content;
}

/**
 * Parse, build, and collect what is wrong: a thrown parse error, a lint issue or a pool issue.
 * Empty means the pack is usable.
 */
type Built = { pack: ReturnType<typeof buildPack> | null; problem: string[]; failing: Set<string> };

/** Lower is better: a soul that does not build is worse than any that does. */
function rank(built: Built): number {
  return built.pack ? built.problem.length : Number.MAX_SAFE_INTEGER;
}

function build(markdown: string, body: Body): Built {
  let pack: ReturnType<typeof buildPack>;
  try {
    pack = buildPack(parseSoul(markdown), markdown, { n: body.n, report: body.report, depth: !body.previous && process.env.SOUL_DEPTH_CHECK !== 'off' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the soul did not parse';
    return { pack: null, problem: [message], failing: new Set(SOUL_SLOTS.filter(slot => message.includes(slot))) };
  }
  const problem = [
    ...pack.issues.map(issue => `${issue.slot === 'web' ? 'web.persona' : issue.slot}: ${issue.rule} (${issue.detail})`),
    ...pack.poolIssues.map(issue => `${issue.pool}: ${issue.detail}`),
  ];
  const failing = new Set<string>([
    ...pack.issues.map(issue => (issue.slot === 'web' ? 'web.persona' : issue.slot)),
    ...pack.poolIssues.map(issue => issue.pool),
  ]);
  return { pack, problem, failing };
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
