import { clampInt } from './affect';
import {
  DELEGATE_KINDS, EPISTEMIC_TRIGGERS, HOOK_KINDS, INTENT_MODES, MOOD_SHIFTS, TURN_SHAPES,
  type Bubble, type DelegateKind, type Envelope, type Status, type ToolCall,
} from './types';
import { coreForLabel, normalizeMoodLabel } from './wheel';

export const MAX_BUBBLES = 5;

/**
 * One line of hers, made plain: markdown off, no em or en dash. Only paired emphasis is
 * unwrapped, so a lone asterisk (`5 * 3 = 15`), `5**2` or a snake_case word stays as written.
 */
export function cleanBubble(t: string): string {
  return t
    .replace(/`+/g, '')
    .replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (_, label: string, url: string) => {
      // a markdown link keeps its address, written bare the way she gives one
      const bare = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return bare === label.trim() ? bare : `${label} ${bare}`;
    })
    .replace(/(^|[^\w*])(\*{1,3})(?=[^\s*])([^*\n]*?[^\s*])\2(?![\w*])/g, '$1$3')
    .replace(/(^|[^\w])(__|~~)(?=\S)([^_~\n]*?\S)\2(?!\w)/g, '$1$3')
    .replace(/^\s*>\s+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+/, '')
    .replace(/[,\s]+$/, '');
}

export function splitBubble(t: string): string[] {
  return t.split(/\n+/).map(cleanBubble).filter(Boolean);
}

export function bubbleTexts(items: unknown[]): string[] {
  return items
    .flatMap(item => {
      const text = typeof item === 'string' ? item : (item as { text?: unknown } | null)?.text;
      return typeof text === 'string' ? splitBubble(text.slice(0, 600)) : [];
    })
    .slice(0, MAX_BUBBLES);
}

/** A finite number from a JSON number or a numeric string. null and booleans are not numbers. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── streaming reader ─────────────────────────────────────────────────────────

/** Where each top-level key's value starts (index after its colon), skipping strings. */
function topLevelValueStarts(raw: string): Map<string, number> {
  const out = new Map<string, number>();
  let depth = 0;
  let inStr = false;
  let esc = false;
  let strStart = -1;
  let lastStr = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') { inStr = false; lastStr = raw.slice(strStart + 1, i); }
      continue;
    }
    if (c === '"') { inStr = true; strStart = i; }
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    // the last occurrence wins, as in JSON.parse, so the stream and the final parse agree
    else if (c === ':' && depth === 1) out.set(lastStr, i + 1);
  }
  return out;
}

/** End index (exclusive) of one complete JSON value starting at or after `start`, or -1 while open. */
function valueEnd(raw: string, start: number): number {
  let i = start;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (i >= raw.length) return -1;
  const c = raw[i];
  if (c === '"') {
    let esc = false;
    for (let j = i + 1; j < raw.length; j++) {
      const d = raw[j];
      if (esc) esc = false;
      else if (d === '\\') esc = true;
      else if (d === '"') return j + 1;
    }
    return -1;
  }
  if (c === '{' || c === '[') {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < raw.length; j++) {
      const d = raw[j];
      if (inStr) {
        if (esc) esc = false;
        else if (d === '\\') esc = true;
        else if (d === '"') inStr = false;
        continue;
      }
      if (d === '"') inStr = true;
      else if (d === '{' || d === '[') depth++;
      else if (d === '}' || d === ']') { depth--; if (depth === 0) return j + 1; }
    }
    return -1;
  }
  const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(i));
  if (!m) return -1;
  const end = i + m[0].length;
  // a scalar is complete only once a delimiter follows it: `8` may still become `82`, `1e` may become `1e2`
  return end < raw.length && /[\s,\]}]/.test(raw[end]) ? end : -1;
}

function arrayItems(raw: string, start: number): { items: unknown[]; done: boolean } {
  let i = start;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== '[') return { items: [], done: false };
  const items: unknown[] = [];
  i++;
  for (;;) {
    while (i < raw.length && /[\s,]/.test(raw[i])) i++;
    if (i >= raw.length) return { items, done: false };
    if (raw[i] === ']') return { items, done: true };
    const end = valueEnd(raw, i);
    if (end < 0) return { items, done: false };
    try { items.push(JSON.parse(raw.slice(i, end))); } catch { return { items, done: false }; }
    i = end;
  }
}

export interface PartialEnvelope {
  confidence?: number;
  toolsDone: boolean;
  tools: ToolCall[] | null;
  bubbles: string[];
  bubblesDone: boolean;
}

export function readPartial(raw: string): PartialEnvelope {
  const start = raw.indexOf('{');
  const src = start < 0 ? '' : raw.slice(start);
  const keys = topLevelValueStarts(src);
  const out: PartialEnvelope = { toolsDone: false, tools: null, bubbles: [], bubblesDone: false };
  const c = keys.get('confidence_level');
  if (c !== undefined) {
    const end = valueEnd(src, c);
    if (end > 0) {
      let n: number | null = null;
      try { n = num(JSON.parse(src.slice(c, end))); } catch { n = null; }
      if (n !== null) out.confidence = clampInt(n, 0, 100);
    }
  }
  const t = keys.get('tool_calls');
  if (t !== undefined) {
    const end = valueEnd(src, t);
    if (end > 0) {
      out.toolsDone = true;
      try { out.tools = normalizeToolCalls(JSON.parse(src.slice(t, end))); } catch { out.tools = null; }
    }
  }
  const b = keys.get('bubbles');
  if (b !== undefined) {
    const r = arrayItems(src, b);
    out.bubbles = bubbleTexts(r.items);
    out.bubblesDone = r.done;
  }
  return out;
}

// ── final normalisation ─────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function normalizeToolCalls(v: unknown): ToolCall[] | null {
  // a lone call written as an object, not a list, is still the call she promised
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : null;
  if (!list) return null;
  for (const item of list) {
    const o = item as { name?: unknown; args?: Record<string, unknown> } | null;
    if (!o || o.name !== 'delegate_to_ops' || !o.args || typeof o.args !== 'object') continue;
    const request = str(o.args.request, 300);
    if (!request) continue;
    const call: ToolCall = {
      name: 'delegate_to_ops',
      args: {
        kind: pick<DelegateKind>(o.args.kind, DELEGATE_KINDS) ?? 'general',
        request,
        effect: o.args.effect === 'act' ? 'act' : 'read',
        meta_prompt: str(o.args.meta_prompt, 1500),
      },
    };
    if (o.args.approved === true) call.args.approved = true;
    return [call];
  }
  return null;
}

export function normalizeStatus(v: unknown): Status | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const word = str(o.mood_label, 24).toLowerCase();
  return {
    mood_label: normalizeMoodLabel(coreForLabel(word), word),
    mood_shift: pick(o.mood_shift, MOOD_SHIFTS) ?? 'steady',
    intent_mode: pick(o.intent_mode, INTENT_MODES),
    turn: pick(o.turn, TURN_SHAPES),
    hook_kind: pick(o.hook_kind, HOOK_KINDS),
    epistemic_trigger: pick(o.epistemic_trigger, EPISTEMIC_TRIGGERS) ?? 'none',
    meta_prompt: str(o.meta_prompt, 240),
    turned_down: str(o.turned_down, 120) || null,
  };
}

export function normalizeEnvelope(v: unknown): Envelope | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const conf = num(o.confidence_level);
  return {
    confidence_level: conf !== null ? clampInt(conf, 0, 100) : 70,
    tool_calls: normalizeToolCalls(o.tool_calls),
    bubbles: bubbleTexts(Array.isArray(o.bubbles) ? o.bubbles : []).map(text => ({ text })),
    status: normalizeStatus(o.status),
  };
}

function jsonSlice(raw: string): string | null {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  return a >= 0 && b > a ? raw.slice(a, b + 1) : null;
}

export function parseEnvelope(raw: string): Envelope | null {
  const slice = jsonSlice(raw);
  if (slice) {
    let parsed: unknown;
    try { parsed = JSON.parse(slice); } catch { parsed = undefined; /* fall through to the partial reader */ }
    if (parsed !== undefined) {
      const env = normalizeEnvelope(parsed);
      // JSON of the wrong shape ({}, {"reply":"hi"}) is no reply; a status with no bubbles is a real, quiet one
      return env && (env.bubbles.length || env.status || env.tool_calls) ? env : null;
    }
  }
  const p = readPartial(raw);
  if (!p.bubbles.length) return null;
  return {
    confidence_level: p.confidence ?? 70,
    tool_calls: p.toolsDone ? p.tools : null,
    bubbles: p.bubbles.map(text => ({ text })),
    status: null,
  };
}

export function parseComposer(raw: string): { bubbles: Bubble[]; status: Partial<Status> } | null {
  const slice = jsonSlice(raw);
  let o: Record<string, unknown> | null = null;
  if (slice) { try { o = JSON.parse(slice) as Record<string, unknown>; } catch { o = null; } }
  const items = o && Array.isArray(o.bubbles) ? o.bubbles : readPartial(raw).bubbles;
  const bubbles = bubbleTexts(items).map(text => ({ text }));
  if (!bubbles.length) return null;
  const s = (o?.status ?? {}) as Record<string, unknown>;
  const status: Partial<Status> = {};
  const word = str(s.mood_label, 24).toLowerCase();
  if (word) status.mood_label = normalizeMoodLabel(coreForLabel(word), word);
  const shift = pick(s.mood_shift, MOOD_SHIFTS);
  if (shift) status.mood_shift = shift;
  const note = str(s.meta_prompt, 240);
  if (note) status.meta_prompt = note;
  return { bubbles, status };
}
