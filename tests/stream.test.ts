import { afterEach, describe, expect, it, vi } from 'vitest';
import { effortsFor } from '../src/components/ModelPicker';
import { forRole, modelsFrom, MODELS, requestCompletion } from '../src/lib/openrouter';
import { withLogging } from '../src/lib/log';
import type { StreamEvent } from '../src/lib/stream';

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

const req = (headers: Record<string, string>) => new Request('http://x', { method: 'POST', headers });

function sse(lines: string[]): Response {
  const body = lines.join('\n') + '\n';
  // Split mid-line on purpose: a chunk boundary must not break a record.
  const cut = Math.floor(body.length / 2);
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body.slice(0, cut)));
        controller.enqueue(encoder.encode(body.slice(cut)));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const chunk = (delta: object, extra: object = {}) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }], ...extra })}`;

describe('reasoning effort', () => {
  it('reads a valid effort per role and ignores junk', () => {
    const picked = modelsFrom(req({ 'x-openrouter-effort-strong': 'HIGH', 'x-openrouter-effort-cheap': 'turbo' }));
    expect(picked.effort).toEqual({ strong: 'high' });
    expect(modelsFrom(req({})).effort).toBeUndefined();
  });

  it('sends the effort with the model, and nothing when unset', () => {
    expect(forRole({ ...MODELS, effort: { strong: 'low' } }, 'strong')).toEqual({ model: MODELS.strong, reasoning: { effort: 'low' } });
    expect(forRole(MODELS, 'strong')).toEqual({ model: MODELS.strong });
  });

  it('offers only what a model supports', () => {
    const info = (reasoning?: { supported_efforts?: string[] | null; mandatory?: boolean }) =>
      ({ id: 'a/b', name: 'b', context: 0, promptPrice: null, completionPrice: null, reasoning });
    expect(effortsFor(info())).toEqual([]);
    expect(effortsFor(info({ supported_efforts: ['max', 'high', 'low', 'none'] }))).toEqual(['none', 'low', 'high', 'max']);
    expect(effortsFor(info({ supported_efforts: ['high', 'low', 'none'], mandatory: true }))).toEqual(['low', 'high']);
    expect(effortsFor(info({ supported_efforts: null }))).toEqual(['low', 'medium', 'high']);
  });
});

describe('streamed completions', () => {
  it('assembles the same result as a plain call and forwards each piece', async () => {
    let sent: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return sse([
        ': OPENROUTER PROCESSING',
        chunk({ reasoning: 'let me ' }),
        chunk({ reasoning: 'think' }),
        chunk({ content: 'hel' }),
        chunk({ content: 'lo' }),
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 3 } } })}`,
        'data: [DONE]',
      ]);
    }) as unknown as typeof fetch;

    const events: StreamEvent[] = [];
    const handler = withLogging('t', async () => {
      const result = await requestCompletion({ key: 'sk-test', messages: [{ role: 'user', content: 'hi' }], reasoning: { effort: 'low' } });
      return Response.json({ content: result.content, reasoningTokens: result.reasoningTokens, finish: result.finishReason });
    });
    const response = await handler(req({ 'x-stream': '1' }));
    expect(response.headers.get('content-type')).toContain('ndjson');
    for (const line of (await response.text()).trim().split('\n')) events.push(JSON.parse(line));

    expect(sent.stream).toBe(true);
    expect(sent.reasoning).toEqual({ effort: 'low' });
    expect(events[0]).toMatchObject({ type: 'start', call: 1, effort: 'low' });
    expect(events.filter(e => e.type === 'reasoning').map(e => (e as { text: string }).text).join('')).toBe('let me think');
    expect(events.filter(e => e.type === 'answer').map(e => (e as { text: string }).text).join('')).toBe('hello');
    expect(events.find(e => e.type === 'end')).toMatchObject({ completion: 9, reasoning: 3, finish: 'stop' });
    expect(events[events.length - 1]).toEqual({ type: 'result', status: 200, body: { content: 'hello', reasoningTokens: 3, finish: 'stop' } });
  });

  it('does not stream unless asked', async () => {
    let sent: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const handler = withLogging('t', async () => Response.json(await requestCompletion({ key: 'sk-test', messages: [] })));
    const response = await handler(req({}));
    expect(sent.stream).toBeUndefined();
    expect(response.headers.get('content-type')).not.toContain('ndjson');
  });

  it('reports a handler failure as the closing result', async () => {
    const handler = withLogging('t', async () => Response.json({ error: 'no report' }, { status: 400 }));
    const lines = (await (await handler(req({ 'x-stream': '1' }))).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(lines[lines.length - 1]).toEqual({ type: 'result', status: 400, body: { error: 'no report' } });
  });

  it('numbers the calls inside one request', async () => {
    globalThis.fetch = vi.fn(async () => sse([chunk({ content: 'a' }), 'data: [DONE]'])) as unknown as typeof fetch;
    const handler = withLogging('t', async () => {
      await requestCompletion({ key: 'sk-test', messages: [] });
      await requestCompletion({ key: 'sk-test', messages: [] });
      return Response.json({});
    });
    const events = (await (await handler(req({ 'x-stream': '1' }))).text()).trim().split('\n').map(line => JSON.parse(line) as StreamEvent);
    expect(events.filter(e => e.type === 'start').map(e => (e as { call: number }).call)).toEqual([1, 2]);
  });
});

describe('api client stream', () => {
  it('passes events through and returns the result body', async () => {
    const { api } = await import('../src/lib/client/api');
    const lines = [{ type: 'start', call: 1, model: 'a/b' }, { type: 'ping' }, { type: 'answer', call: 1, text: 'x' }, { type: 'result', status: 200, body: { ok: 1 } }];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['x-stream']).toBe('1');
      return new Response(lines.map(line => JSON.stringify(line)).join('\n') + '\n');
    }) as unknown as typeof fetch;
    const seen: string[] = [];
    await expect(api('/api/x', 'sk-test', {}, event => seen.push(event.type))).resolves.toEqual({ ok: 1 });
    expect(seen).toEqual(['start', 'answer']);
  });

  it('raises the server error carried by the closing result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = await import('../src/lib/client/api');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ type: 'result', status: 502, body: { error: 'bad soul', id: 'abc' } }) + '\n')) as unknown as typeof fetch;
    await expect(api('/api/x', 'sk-test', {}, () => {})).rejects.toMatchObject({ message: 'bad soul', requestId: 'abc', status: 502 });
  });

  it('fails clearly when the connection ends without a result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = await import('../src/lib/client/api');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ type: 'start', call: 1, model: 'a/b' }) + '\n')) as unknown as typeof fetch;
    await expect(api('/api/x', 'sk-test', {}, () => {})).rejects.toThrow(/closed before the answer/);
  });
});
