import { HttpError, listModels, MODELS } from '../../../src/lib/openrouter';

export const runtime = 'nodejs';

/** The OpenRouter catalogue is public, so no key is needed to browse it. */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ models: await listModels(), defaults: MODELS });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: 'model list failed' }, { status: 500 });
  }
}
