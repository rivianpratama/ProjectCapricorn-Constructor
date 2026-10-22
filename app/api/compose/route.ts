import { complete, HttpError, keyFrom, modelsFrom, type Models } from '../../../src/lib/openrouter';
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
    let soul = parseSoul(markdown);
    let pack = buildPack(soul, markdown, { n: body.n, report: body.report });

    if (pack.issues.length || pack.poolIssues.length) {
      const problems = [
        ...pack.issues.map(issue => `${issue.slot}: ${issue.rule} (${issue.detail})`),
        ...pack.poolIssues.map(issue => `${issue.pool}: ${issue.detail}`),
      ];
      markdown = await compose(
        key,
        models,
        system,
        [user, '', '## Fix these before answering again', ...problems.map(problem => `- ${problem}`), '', 'Rewrite the whole soul, changing only what these demand.'].join('\n'),
      );
      soul = parseSoul(markdown);
      pack = buildPack(soul, markdown, { n: body.n, report: body.report });
    }

    return Response.json({
      markdown,
      files: pack.files,
      issues: pack.issues,
      poolIssues: pack.poolIssues,
    });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'compose failed';
    return Response.json({ error: message }, { status: 500 });
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
  return complete({
    key,
    model: models.strong,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.6,
    maxTokens: 24_000,
  });
}
