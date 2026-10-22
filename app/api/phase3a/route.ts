import { complete, HttpError, keyFrom, MODELS, parseJson } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { parseQuestionnaire } from '../../../src/lib/schema/questionnaire';

export const runtime = 'nodejs';

interface Body {
  report: string;
  n: number;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const body = (await request.json()) as Body;
    if (!body?.report) throw new HttpError(400, 'no report');

    const content = await complete({
      key,
      model: MODELS.strong,
      json: true,
      messages: [
        { role: 'system', content: prompt('phase3a') },
        { role: 'user', content: `Built from ${body.n} chat${body.n === 1 ? '' : 's'}.\n\n${body.report}` },
      ],
      temperature: 0.2,
      maxTokens: 8_000,
    });

    const questionnaire = parseQuestionnaire(parseJson(content));
    return Response.json({ questionnaire });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'phase 3a failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
