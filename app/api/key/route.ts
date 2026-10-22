import { HttpError, keyFrom, validateKey } from '../../../src/lib/openrouter';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    await validateKey(keyFrom(request));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: 'key check failed' }, { status: 500 });
  }
}
