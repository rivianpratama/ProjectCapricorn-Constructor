import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { HttpError, listModels, MODELS } from '../../../src/lib/openrouter';

export const runtime = 'nodejs';

/** The OpenRouter catalogue is public, so no key is needed to browse it. */
export async function GET(request: Request): Promise<Response> {
  return withLogging('models', handle)(request);
}

async function handle(): Promise<Response> {
  try {
    return Response.json({ models: await listModels(), defaults: MODELS });
  } catch (error) {
    return failed(error, 'model list failed');
  }
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: fallback }, { status: 500 });
}
