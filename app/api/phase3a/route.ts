import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeLongForm, HttpError, keyFrom, modelsFrom, parseJson, forRole } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { buildQuestionnaire } from '../../../src/lib/schema/questionnaire';

export const runtime = 'nodejs';

const MARKDOWN_LIMIT = 64_000;

interface Body {
  report: string;
  n: number;
}

export async function POST(request: Request): Promise<Response> {
  return withLogging('phase3a', handle)(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    if (!body?.report) throw new HttpError(400, 'no report');

    const content = (
      await completeLongForm({
        key,
        ...forRole(models, 'strong'),
        json: true,
        messages: [
          { role: 'system', content: prompt('phase3a') },
          { role: 'user', content: `Built from ${body.n} chat${body.n === 1 ? '' : 's'}.\n\n${body.report}` },
        ],
        temperature: 0.2,
        maxTokens: 8_000,
      })
    ).content;

    const questionnaire = buildQuestionnaire(parseJson(content));
    // The report's markdown carries the questions nothing depends on; the client keeps the parsed
    // report instead, so a long report does not fail a closure check over an oversized payload.
    return Response.json({ questionnaire, markdown: content.length <= MARKDOWN_LIMIT ? content : undefined });
  } catch (error) {
    return failed(error, 'phase 3a failed');
  }
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
