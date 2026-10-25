import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Server-side logging.
 *
 * Every route wraps its handler in `withLogging`, which gives the request an id,
 * logs one line when it finishes, and logs any unexpected throw with its stack.
 * While the handler runs, that id and the route name ride along in async context,
 * so `log.*` calls deep inside a pipeline are still attributable.
 *
 * The OpenRouter key arrives in a request header and must never reach a log
 * (AGENTS.md rule 3), so every event is redacted on the way out, not at the call
 * site: a caller cannot forget.
 */

/** `silent` is never written; it is how a test run or a quiet install turns the logger off. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogEvent {
  level: Exclude<LogLevel, 'silent'>;
  msg: string;
  time: string;
  id?: string;
  route?: string;
  [field: string]: unknown;
}

export interface LoggerConfig {
  /** The quietest level that still gets written. Default `LOG_LEVEL`, else `info`. */
  level: LogLevel;
  /** Where events go. A sink that throws is skipped, never fatal. */
  sinks: Sink[];
}

export type Sink = (event: LogEvent) => void;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const REDACTED = '[redacted]';

/** A bearer token or an OpenRouter-style key, as it might turn up inside an error message. */
const SECRET = /\b(sk|pk|or)-[A-Za-z0-9_-]{3,}/g;
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
/** A request id we are willing to echo back and log. */
const ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[too deep]';
  if (typeof value === 'string') return scrub(value);
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) return describeError(value);
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [field, item] of Object.entries(value)) {
      out[field] = isSensitive(field) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

const CREDENTIAL_WORDS = new Set([
  'key',
  'keys',
  'apikey',
  'authorization',
  'token',
  'secret',
  'password',
  'cookie',
]);

/** Lowercased comparison, so no regex flags are involved in a security decision. */
export function isSensitive(field: string): boolean {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[ _.-]+/)
    .some(word => CREDENTIAL_WORDS.has(word));
}

function scrub(text: string): string {
  return text.replace(BEARER, '$1 ' + REDACTED).replace(SECRET, REDACTED);
}

/** A thrown value as plain data, with the first few stack lines kept for diagnosis. */
export function describeError(error: unknown): { name: string; message: string; stack?: string } {
  if (!(error instanceof Error)) return { name: 'Thrown', message: scrub(typeof error === 'string' ? error : String(error)) };
  const stack = error.stack
    ?.split('\n')
    .slice(0, 6)
    .map(line => line.trim())
    .join('\n');
  return { name: error.name, message: scrub(error.message), stack: stack ? scrub(stack) : `${error.name}: ${scrub(error.message)}` };
}

function consoleSink(event: LogEvent): void {
  const { level, msg, ...rest } = event;
  const line = `[${level}] ${msg}`;
  const fields = redact(rest);
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  writer(line, fields);
}

function envLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (value === 'off') return 'silent';
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'silent'
    ? value
    : 'info';
}

let config: LoggerConfig = { level: envLevel(), sinks: [consoleSink] };

/** For tests and for `instrumentation.ts`. Omitted fields keep their current value. */
export function configureLogger(next: Partial<LoggerConfig>): void {
  config = { ...config, ...next };
}

/** The console is the default sink; exported so tests can swap it back. */
export const CONSOLE_SINK: Sink = consoleSink;

interface RequestScope {
  id: string;
  route: string;
}

const scope = new AsyncLocalStorage<RequestScope>();

/** A safe request id from the header, or null for anything malformed. */
export function requestIdFrom(header: string | null): string | null {
  const value = header?.trim();
  return value && ID.test(value) ? value : null;
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

/** The id of the request being handled, if any. */
export function currentRequestId(): string | undefined {
  return scope.getStore()?.id;
}

/** Sets the id only when no request scope is active; a no-op inside `withLogging`. */
export function setRequestId(id: string | null): void {
  if (scope.getStore()) return;
  if (id) scope.enterWith({ id, route: '' });
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[config.level]) return;
  const store = scope.getStore();
  const event: LogEvent = {
    ...(redact(fields ?? {}) as Record<string, unknown>),
    level: level as LogEvent['level'],
    msg,
    time: new Date().toISOString(),
    ...(store?.id ? { id: store.id } : {}),
    ...(store?.route ? { route: store.route } : {}),
  };
  for (const sink of config.sinks) {
    try {
      sink(event);
    } catch {
      // A broken sink must never turn a logged warning into a failed request.
    }
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

/** An error whose status and message are meant for the client, so it is not a server failure. */
export interface ClientFacing {
  status: number;
  message: string;
}

function isClientFacing(error: unknown): error is ClientFacing & Error {
  const candidate = error as Partial<ClientFacing>;
  return (
    error instanceof Error &&
    typeof candidate.status === 'number' &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 400 &&
    candidate.status < 600
  );
}

export type Handler = (request: Request) => Promise<Response>;

/**
 * Wraps a route handler. An unexpected throw becomes the JSON error the UI
 * already reads, now carrying the request id so a user report can be matched to
 * a log line. The response goes out first; the closing log line lands after.
 */
export function withLogging(route: string, handler: Handler): Handler {
  return async (request: Request): Promise<Response> => {
    const id = requestIdFrom(request.headers.get('x-request-id')) ?? newRequestId();
    const started = performance.now();
    const schedule = await scheduler();

    return scope.run({ id, route }, async () => {
      let response: Response;
      try {
        response = await handler(request);
      } catch (error) {
        response = failure(error, id);
      }
      const status = response.status;
      const ms = Math.round(performance.now() - started);
      schedule(() =>
        emit(status >= 500 ? 'error' : 'info', 'request', { event: 'request', method: request.method, status, ms }),
      );
      return response;
    });
  };
}

function failure(error: unknown, id: string): Response {
  if (isClientFacing(error)) return Response.json({ error: error.message, id }, { status: error.status });
  log.error('request failed', { error });
  const message = error instanceof Error ? redact(error.message) : 'request failed';
  return Response.json({ error: message, id }, { status: 500 });
}

type Schedule = (task: () => void) => void;

let nextAfter: Promise<Schedule | null> | null = null;

/**
 * Next's `after` runs the task once the response is on its way. It throws
 * outside a request scope, which is what vitest and scripts are, so probe it per
 * request (never cache the probe's outcome) and fall back to a microtask there.
 */
async function scheduler(): Promise<Schedule> {
  nextAfter ??= import('next/server')
    .then(({ after }) => after as Schedule)
    .catch(() => null);
  const after = await nextAfter;
  if (after) {
    try {
      after(() => {});
      return after;
    } catch {
      // Outside a request scope.
    }
  }
  return inline;
}

const inline: Schedule = task => void Promise.resolve().then(task);
