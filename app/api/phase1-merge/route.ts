import { complete, HttpError, keyFrom, modelsFrom } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { parseEngram } from '../../../src/lib/schema/engram';

export const runtime = 'nodejs';

interface Body {
  chat: string;
  engrams: string[];
}

export async function POST(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    if (!body?.engrams?.length) throw new HttpError(400, 'no chunk engrams');

    const user = [
      `Chat label: ${body.chat}`,
      `Chunks: ${body.engrams.length}`,
      '',
      ...body.engrams.flatMap((engram, i) => [`## Chunk ${i + 1}`, '', engram, '']),
    ].join('\n');

    const markdown = await complete({
      key,
      model: models.cheap,
      messages: [
        { role: 'system', content: prompt('phase1-merge') },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      maxTokens: 24_000,
    });

    const engram = parseEngram(markdown, body.chat);
    return Response.json({ markdown, engram });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'merge failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
