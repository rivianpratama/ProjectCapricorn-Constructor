import type { HistoryItem, RefusalReason } from './types';

/**
 * Money is counted in micro-dollars (1 = $0.000001), whole numbers, so the limiter's integer
 * counters can hold a spend exactly.
 */
export const MICROS_PER_USD = 1_000_000;

export interface LimitConfig {
  /** What one person may spend on tokens, in micro-dollars: per session, and again per IP per UTC day. */
  budget: number;
  ipMinute: number;
  globalTurnsDay: number;
  globalCallsDay: number;
}

/**
 * The quota is money, not messages (owner, 2026-10-06): $0.05 of real token spend per person,
 * however many messages that buys. Every call is charged what it actually cost (llm.ts usage.usd),
 * so a cached prefix and short texts buy a longer chat. The IP day has the same budget as the
 * session, so a new chat buys nothing more.
 */
export const DEFAULT_LIMITS: LimitConfig = {
  budget: 50_000,
  ipMinute: 8,
  globalTurnsDay: 3000,
  globalCallsDay: 4500,
};

/** Whole digits only: parseInt would read "4,500" as 4 and "1e4" as 1 and quietly shut the demo. */
function posInt(v: unknown, fallback: number): number {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return fallback;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** A plain dollar amount ("0.05") in micro-dollars; anything else (a "$", a comma, "5e-2") is the fallback. */
function posUsd(v: unknown, fallback: number): number {
  const s = String(v ?? '').trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return fallback;
  const n = Math.round(Number(s) * MICROS_PER_USD);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** Local `vite dev` (owner, 2026-10-06): no limits at all. Only the deployed site enforces them. */
export const NO_LIMITS: LimitConfig = {
  budget: Number.MAX_SAFE_INTEGER,
  ipMinute: Number.MAX_SAFE_INTEGER,
  globalTurnsDay: Number.MAX_SAFE_INTEGER,
  globalCallsDay: Number.MAX_SAFE_INTEGER,
};

export function limitsFromEnv(env: Partial<Record<string, unknown>>): LimitConfig {
  return {
    budget: posUsd(env.BUDGET_USD, DEFAULT_LIMITS.budget),
    ipMinute: posInt(env.LIMIT_IP_MINUTE, DEFAULT_LIMITS.ipMinute),
    globalTurnsDay: posInt(env.LIMIT_GLOBAL_TURNS_DAY, DEFAULT_LIMITS.globalTurnsDay),
    globalCallsDay: posInt(env.LIMIT_GLOBAL_CALLS_DAY, DEFAULT_LIMITS.globalCallsDay),
  };
}

/** `session` and `ipDay` are micro-dollars spent; the rest are request counts. */
export interface Counts { session: number; ipDay: number; ipMinute: number; globalTurns: number; globalCalls: number }
export type TakeKind = 'chat' | 'compose' | 'peek';

export interface Decision {
  ok: boolean;
  reason: RefusalReason | null;
  /** Micro-dollars left of the budget before this call's spend. */
  creditsLeft: number;
  /** The budget, in micro-dollars. */
  creditsMax: number;
  /** Her goodbye turn: too little budget left for another after it. routes.ts spends the rest on it. */
  lastCredit: boolean;
  inc: Counts;
}

const NONE: Counts = { session: 0, ipDay: 0, ipMinute: 0, globalTurns: 0, globalCalls: 0 };

/** A turn is her last when what is left would not cover two more of this size (the estimate is pessimistic). */
const LAST_TURN_MARGIN = 2;

/**
 * Charges only the request counters; the spend is charged after the call, at its real cost
 * (Limiter.spend). `estimate` is this chat turn's pessimistic cost (estimateTurnMicros).
 */
export function decide(c: Counts, kind: TakeKind, cfg: LimitConfig, estimate = 0): Decision {
  const creditsMax = cfg.budget;
  const left = Math.max(0, Math.min(cfg.budget - c.session, cfg.budget - c.ipDay));
  const refuse = (reason: RefusalReason): Decision => ({ ok: false, reason, creditsLeft: left, creditsMax, lastCredit: false, inc: NONE });
  if (kind === 'peek') return { ok: true, reason: null, creditsLeft: left, creditsMax, lastCredit: false, inc: NONE };
  if (kind === 'chat') {
    if (c.session >= cfg.budget) return refuse('session');
    if (c.ipDay >= cfg.budget) return refuse('ip');
    if (c.globalTurns >= cfg.globalTurnsDay || c.globalCalls >= cfg.globalCallsDay) return refuse('global');
    if (c.ipMinute >= cfg.ipMinute) return refuse('burst');
    return {
      ok: true, reason: null, creditsLeft: left, creditsMax, lastCredit: left < LAST_TURN_MARGIN * estimate,
      inc: { ...NONE, ipMinute: 1, globalTurns: 1, globalCalls: 1 },
    };
  }
  // A compose finishes a look the chat turn already promised, so it runs on whatever is left.
  if (c.globalCalls >= cfg.globalCallsDay) return refuse('global');
  if (c.ipMinute >= cfg.ipMinute) return refuse('burst');
  return { ok: true, reason: null, creditsLeft: left, creditsMax, lastCredit: false, inc: { ...NONE, ipMinute: 1, globalCalls: 1 } };
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function utcMinute(now: number): string {
  return new Date(now).toISOString().slice(0, 16);
}

// ─── What a call costs ───

/** USD per million tokens. */
export interface Price { miss: number; hit: number; out: number }

/**
 * DeepSeek direct, deepseek-flash, at its peak rate (off-peak is half; api-docs.deepseek.com,
 * 2026-10-06). It prices a call whose usage carries no cost of its own: OpenRouter's does (usage.cost).
 */
export const DEEPSEEK_PEAK: Price = { miss: 0.3, hit: 0.006, out: 1.2 };

export function usdOf(tokens: { prompt: number; cached: number; completion: number }, p: Price): number {
  const miss = Math.max(0, tokens.prompt - tokens.cached);
  return (miss * p.miss + tokens.cached * p.hit + tokens.completion * p.out) / 1_000_000;
}

/** The system prompt in tokens, rounded up (~28,000 chars); it is cached on every turn but the first. */
const SYSTEM_TOKENS = 9_000;
/** The per-turn <prompt> blocks (drift anchor, last step and samples included) and the JSON anchor, in chars, rounded up. */
const TAIL_CHARS = 4_500;

/**
 * A pessimistic cost of one chat turn in micro-dollars: the dearest provider in use, everything
 * but the system prompt uncached, 3 chars a token (Chinese, Japanese or Korean text is nearer 1),
 * and a reply as long as `maxTokens`.
 */
export function estimateTurnMicros(history: readonly HistoryItem[], text: string, maxTokens: number): number {
  const chars = historyChars(history) + text.length + TAIL_CHARS;
  const tokens = { prompt: SYSTEM_TOKENS + Math.ceil(chars / 3), cached: SYSTEM_TOKENS, completion: maxTokens };
  return Math.ceil(usdOf(tokens, DEEPSEEK_PEAK) * MICROS_PER_USD);
}

// ─── The chat's length (owner, 2026-10-06) ───
// The history is never trimmed from the front: dropping the oldest message would change the
// start of the prompt every turn and miss the provider's prefix cache. A chat grows whole until
// its budget is spent.
/**
 * A backstop, not a quota: an honest chat spends its $0.05 long before this (a WhatsApp-style chat
 * is ~200 chars a turn). It bounds one request's size and a forged or tampered history.
 */
export const HISTORY_MAX_CHARS = 100_000;
/** /api/chat and /api/compose take a body up to this: a full history in 3-byte UTF-8, the state and the text. */
export const WIRE_MAX_BYTES = 320_000;

export function historyChars(history: readonly HistoryItem[]): number {
  return history.reduce((n, x) => n + (x.role === 'user' ? x.text.length : x.bubbles.join(' ').length), 0);
}

/** True once the history is past the backstop: no turn is taken on top of it. */
export function historyFull(history: readonly HistoryItem[]): boolean {
  return historyChars(history) > HISTORY_MAX_CHARS;
}
