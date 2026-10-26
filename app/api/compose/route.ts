import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeLongForm, HttpError, keyFrom, modelsFrom, type Models } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { parseSoul } from '../../../src/lib/soul/parseSoul';
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
    // Code fixes the slips it can (digits, dashes, colons, duplicates) before anything is judged, so a
    // 24k-token generation is not thrown away over a character. The rest goes to a repair turn.
    const attempt = async (text: string): Promise<{ markdown: string; built: Built }> => {
      const markdown = sanitizeSoul(await compose(key, models, system, text)).markdown;
      return { markdown, built: build(markdown, body) };
    };

    let current = await attempt(user);
    let best = current;
    // A soul that will not parse or lint is a few lines from right. Two repair turns at most, and the
    // best soul seen wins, so a worse rewrite never replaces a better one.
    for (let round = 0; round < 2 && current.built.problem.length > 0; round++) {
      const repair = [
        user,
        ...(current.built.pack ? ['', '## Your previous soul', current.markdown] : []),
        '',
        '## Fix these before answering again',
        ...current.built.problem.map(problem => `- ${problem}`),
        '',
        current.built.pack
          ? 'Rewrite the whole soul, changing only what these demand.'
          : 'Answer with the whole SOUL.md: one H2 per slot, in order, and nothing else.',
      ].join('\n');
      try {
        current = await attempt(repair);
      } catch (error) {
        // A repair that fails to arrive must not cost the soul already in hand.
        if (!best.built.pack) throw error;
        log.warn('repair turn failed; keeping the best soul so far', { error });
        break;
      }
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
type Built = { pack: ReturnType<typeof buildPack> | null; problem: string[] };

/** Lower is better: a soul that does not build is worse than any that does. */
function rank(built: Built): number {
  return built.pack ? built.problem.length : Number.MAX_SAFE_INTEGER;
}

function build(markdown: string, body: Body): Built {
  let pack: ReturnType<typeof buildPack>;
  try {
    pack = buildPack(parseSoul(markdown), markdown, { n: body.n, report: body.report });
  } catch (error) {
    return { pack: null, problem: [error instanceof Error ? error.message : 'the soul did not parse'] };
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
