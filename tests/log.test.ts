import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureLogger,
  CONSOLE_SINK,
  describeError,
  isSensitive,
  log,
  redact,
  requestIdFrom,
  setRequestId,
  withLogging,
} from '../src/lib/log';
import type { ApiError } from '../src/lib/client/api';

beforeEach(() => {
  configureLogger({ level: 'info', sinks: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request ids', () => {
  it('takes a safe id from the header and rejects junk', () => {
    expect(requestIdFrom('abc-123')).toBe('abc-123');
    expect(requestIdFrom('  spaced.id_1:2  ')).toBe('spaced.id_1:2');
    expect(requestIdFrom(null)).toBeNull();
    expect(requestIdFrom('bad id with spaces')).toBeNull();
    expect(requestIdFrom('x'.repeat(80))).toBeNull();
  });
});

describe('redaction', () => {
  it('hides OpenRouter-style keys in any string', () => {
    expect(redact('sent Bearer sk-or-v1-0123456789abcdef to upstream')).toBe('sent Bearer [redacted] to upstream');
    expect(redact('key sk-test-abcdefgh')).toBe('key [redacted]');
    expect(redact('sk-or-v1-anotherone')).toBe('[redacted]');
  });

  it('hides secret values under sensitive field names', () => {
    expect(redact({ key: 'abc', headers: { authorization: 'Bearer zzz', 'x-openrouter-key': 'q' } })).toEqual({
      key: '[redacted]',
      headers: { authorization: '[redacted]', 'x-openrouter-key': '[redacted]' },
    });
  });

  it('tells a credential apart from a budget', () => {
    expect(isSensitive('apiKey')).toBe(true);
    expect(isSensitive('x-openrouter-key')).toBe(true);
    expect(isSensitive('access_token')).toBe(true);
    expect(isSensitive('maxKey')).toBe(true);
    expect(isSensitive('maxTokens')).toBe(false);
    expect(isSensitive('promptTokens')).toBe(false);
    expect(isSensitive('reasoningTokens')).toBe(false);
    expect(isSensitive('model')).toBe(false);
  });

  it('redacts inside thrown errors too', () => {
    const described = describeError(new Error('fetch failed for sk-or-v1-diecinetwothreefour'));
    expect(described.message).not.toContain('sk-or-v1-');
    expect(described.message).toContain('[redacted]');
  });
});

describe('the logger', () => {
  it('swallows a throwing sink instead of breaking the request', () => {
    const sink = vi.fn(() => {
      throw new Error('disk full');
    });
    configureLogger({ level: 'info', sinks: [sink] });
    expect(() => log.info('still fine')).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('does not log a level below the configured minimum', () => {
    const sink = vi.fn();
    configureLogger({ level: 'warn', sinks: [sink] });
    log.debug('quiet');
    log.info('quiet');
    log.warn('loud');
    const events = sink.mock.calls.map(([event]) => (event as { level: string }).level);
    expect(events).toEqual(['warn']);
  });

  it('lands errors on console.error with the message and stack intact', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    configureLogger({ level: 'info', sinks: [CONSOLE_SINK] });
    const error = new Error('boom');
    log.error('something broke', { error });
    expect(spy).toHaveBeenCalledTimes(1);
    const [line, fields] = spy.mock.calls[0];
    expect(String(line)).toContain('[error] something broke');
    expect((fields as { error: { message: string; name: string } }).error.message).toBe('boom');
    expect((fields as { error: { name: string } }).error.name).toBe('Error');
  });
});

describe('withLogging', () => {
  function request(path: string, headers: Record<string, string> = {}): Request {
    return new Request(`http://localhost${path}`, { method: 'POST', headers });
  }

  it('answers with an error id and logs the cause without leaking headers', async () => {
    const sink = vi.fn();
    configureLogger({ level: 'info', sinks: [sink] });
    const route = withLogging('cardio', async () => {
      throw new Error('secret failure sk-or-v1-shouldnotleak');
    });
    const response = await route(request('/api/cardio', { 'x-openrouter-key': 'sk-or-v1-realkey', 'x-request-id': 'req-9' }));
    expect(response.status).toBe(500);
    const data = (await response.json()) as { error: string; id: string };
    expect(data.error).toBe('secret failure [redacted]');
    expect(data.id).toBe('req-9');

    const events = sink.mock.calls.map(([event]) => event as Record<string, unknown>);
    const done = events.find(event => event.event === 'request');
    expect(done).toMatchObject({ route: 'cardio', method: 'POST', status: 500, id: 'req-9' });
    expect(done?.ms).toBeTypeOf('number');
    expect(JSON.stringify(events)).not.toContain('sk-or-v1-realkey');
    expect(JSON.stringify(events)).not.toContain('shouldnotleak');
  });

  it('returns deliberately raised errors without logging them as failures', async () => {
    const sink = vi.fn();
    configureLogger({ level: 'debug', sinks: [sink] });
    class HttpError extends Error {
      constructor(
        public status: number,
        message: string,
      ) {
        super(message);
      }
    }
    const route = withLogging('cardio', async () => {
      throw new HttpError(400, 'bad input');
    });
    const response = await route(request('/api/cardio'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'bad input' });
    const levels = sink.mock.calls.map(([event]) => (event as { level: string }).level);
    expect(levels).not.toContain('warn');
    expect(levels).not.toContain('error');
  });

  it('carries the id and route into logs written while the handler runs', async () => {
    const sink = vi.fn();
    configureLogger({ level: 'debug', sinks: [sink] });
    const route = withLogging('compose', async () => {
      log.debug('pass 1 done');
      return Response.json({ ok: true });
    });
    await route(request('/api/compose', { 'x-request-id': 'abc' }));
    const event = sink.mock.calls.find(([event]) => (event as { msg: string }).msg === 'pass 1 done')?.[0] as Record<string, unknown>;
    expect(event).toMatchObject({ level: 'debug', route: 'compose', id: 'abc', msg: 'pass 1 done' });
    setRequestId(null);
  });
});

describe('every route goes through the logger', () => {
  const routes = ['compose', 'fidelity', 'key', 'models', 'phase1', 'phase1-merge', 'phase2', 'phase3a', 'try'];

  it.each(routes)('%s exports a wrapped handler', async name => {
    const module = (await import(`../app/api/${name}/route`)) as Record<string, unknown>;
    const handlers = [module.POST, module.GET].filter(value => typeof value === 'function');
    expect(handlers.length).toBeGreaterThan(0);
    // A wrapped handler catches its own throws; an unwrapped one lets them escape.
    for (const handler of handlers as Array<(request: Request) => Promise<Response>>) {
      const response = await handler(new Request('http://localhost/api/x', { method: 'POST', body: '{bad json' }));
      // `models` needs no body and only reads OpenRouter's public catalogue, so it can genuinely succeed.
      expect(response.status).toBeGreaterThanOrEqual(name === 'models' ? 200 : 400);
    }
  });
});

describe('the browser half', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: memory(), localStorage: memory() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;

  });

  function memory(): Storage {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (name: string) => store.get(name) ?? null,
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (name: string) => void store.delete(name),
      setItem: (name: string, value: string) => void store.set(name, value),
    } as Storage;
  }

  it('sends a request id and keeps the api key out of the log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = await import('../src/lib/client/api');
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-request-id']).toMatch(/^[0-9a-f]{8}$/);
      return new Response(JSON.stringify({ error: 'no report', id: 'server-1' }), { status: 400 });
    }) as unknown as typeof fetch;

    const failure = (await api('/api/compose', 'sk-or-v1-super-secret', {}).catch(error => error)) as ApiError;
    expect(failure.message).toBe('no report');
    expect(failure.requestId).toBe('server-1');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('sk-or-v1-super-secret');
  });

  it('logs a request that never reached the server', async () => {
    // Placed after the spy: the outer `afterEach` restores mocks once this test is done.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = await import('../src/lib/client/api');
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(api('/api/try', 'sk-test', {})).rejects.toThrow('could not reach the server');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
