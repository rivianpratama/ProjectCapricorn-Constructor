import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeLongForm, HttpError, keyFrom, modelsFrom, type Models } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { parseSoul } from '../../../src/lib/soul/parseSoul';
import { buildPack } from '../../../src/lib/soul/pack';
import { extractSlots, readAdapter, readSlotFile } from '../../../src/lib/soul/slots';

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

    const user = body.previous
      ? [
          'This is a revision pass. The soul below already works, so keep everything that is not named here.',
          'Change only what these notes demand, then return the whole soul again.',
          '',
          ...(body.fixes ?? []).map(fix => `- ${fix}`),
          '',
          '## Current soul',
          body.previous,
          '',
          '## Decisions already applied',
          ...Object.entries(body.answers ?? {}).map(([id, answer]) => `- ${id}: ${answer}`),
        ].join('\n')
      : [
          'The engram report follows, then the decisions the owner made, then Iris as it stands.',
          '',
          body.report,
          '',
          '## Decisions',
          ...Object.entries(body.answers ?? {}).map(([id, answer]) => `- ${id}: ${answer}`),
          '',
          '## Iris as it stands',
          ...Object.entries(baseSlots()).flatMap(([slot, text]) => [`### ${slot}`, text, '']),
        ].join('\n');

    const system = prompt('phase3b');
    let markdown = await compose(key, models, system, user);
    let built = build(markdown, body);

    // A soul that will not parse or build is one emit block away from right, and a 24k-token
    // generation is too expensive to throw away over a heading or a fence.
    for (let attempt = 0; attempt < 2 && built.problem.length > 0; attempt++) {
      const repair = [
        user,
        '',
        '## Fix these before answering again',
        ...built.problem.map(problem => `- ${problem}`),
        '',
        'Rewrite the whole soul, changing only what these demand.',
      ].join('\n');
      markdown = await compose(key, models, system, repair);
      built = build(markdown, body);
    }
    if (built.problem.length) throw new HttpError(502, `${built.problem[0]} (after two attempts)`);
    const { pack } = built;

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

/** Iris's current slot text, read read-only through the adapter. */
function baseSlots(): Record<string, string> {
  const adapter = readAdapter();
  const out: Record<string, string> = {};
  for (const key of ['irises', 'irises-web'] as const) {
    const target = adapter.targets[key];
    if (!target) continue;
    for (const file of target.files) {
      const extracted = extractSlots(readSlotFile(target, file));
      for (const slot of file.slots) {
        if (out[slot.soul] === undefined && extracted[slot.id] !== undefined) out[slot.soul] = extracted[slot.id];
      }
    }
  }
  return out;
}

async function compose(key: string, models: Models, system: string, user: string): Promise<string> {
  return (
    await completeLongForm({
      key,
      model: models.strong,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
      maxTokens: 24_000,
    })
  ).content;
}

/**
 * Parse, build, and collect what is wrong: a thrown parse error, a lint issue or a pool issue.
 * Empty means the pack is usable.
 */
function build(markdown: string, body: Body): { pack: ReturnType<typeof buildPack>; problem: string[] } {
  let pack: ReturnType<typeof buildPack>;
  try {
    pack = buildPack(parseSoul(markdown), markdown, { n: body.n, report: body.report });
  } catch (error) {
    return { pack: null as unknown as ReturnType<typeof buildPack>, problem: [error instanceof Error ? error.message : 'the soul did not parse'] };
  }
  const problem = [
    ...pack.issues.map(issue => `${issue.slot}: ${issue.rule} (${issue.detail})`),
    ...pack.poolIssues.map(issue => `${issue.pool}: ${issue.detail}`),
  ];
  return { pack, problem };
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
