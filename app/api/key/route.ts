import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { HttpError, keyFrom, validateKey } from '../../../src/lib/openrouter';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return withLogging('key', handle)(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    await validateKey(keyFrom(request));
    return Response.json({ ok: true });
  } catch (error) {
    return failed(error, 'key check failed');
  }
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: fallback }, { status: 500 });
}
