import {
  advanceAffect,
  computeClock,
  initialAffect,
  parseEnvelope,
  planTurn,
  pushHook,
  type AffectState,
  type ClockInfo,
  type Envelope,
  type TailInput,
  type TurnInfo,
} from '../../../vendor/irises-web/current';
import { buildTail, type TryTailInput } from './tail';

/**
 * The Try page's turn loop. It is IrisesWeb's own `planTurn` and `advanceAffect`, imported from
 * the pinned snapshot: the state the demo page keeps, the directives and caps it compiles, the
 * crisis lexicon it reads and the tail it frames all come from there. Only two things are ours:
 * the pack's voice pools (see ./tail) and the state that rides between requests.
 */
export type TryState = AffectState;

export interface PlannedTurn {
  clock: ClockInfo;
  turn: TurnInfo;
  tail: TailInput;
}

export function createTryState(nowMs: number, tz: string): TryState {
  return initialAffect(nowMs, tz);
}

/** One turn as IrisesWeb plans it: the weather it derives and the tail it frames from it. */
export function planTryTurn(input: {
  state: TryState;
  tz: string;
  text: string;
  nowMs: number;
  lastCredit?: boolean;
}): PlannedTurn {
  const clock = computeClock(input.nowMs, input.tz);
  const { turnInfo, tail } = planTurn({
    state: input.state,
    clock,
    tz: input.tz,
    text: input.text,
    lastCredit: input.lastCredit ?? false,
    now: input.nowMs,
  });
  return { clock, turn: turnInfo, tail };
}

export function buildTryTail(plan: PlannedTurn, pack: Record<string, string>): string {
  return buildTail(plan.tail as TryTailInput, pack);
}

export function readEnvelope(raw: string): Envelope | null {
  const direct = parseEnvelope(raw);
  if (direct) return direct;

  // 1. Strip <think>...</think> blocks from reasoning models
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const withoutThink = parseEnvelope(stripped);
  if (withoutThink) return withoutThink;

  // 2. Sanitize unescaped control characters in JSON strings
  const sanitized = parseEnvelope(sanitizeJsonStrings(stripped));
  if (sanitized) return sanitized;

  // 3. Fallback for single reply/text/message field
  try {
    const a = stripped.indexOf('{');
    const b = stripped.lastIndexOf('}');
    if (a >= 0 && b > a) {
      const obj = JSON.parse(sanitizeJsonStrings(stripped.slice(a, b + 1))) as Record<string, unknown>;
      const text =
        typeof obj.reply === 'string'
          ? obj.reply
          : typeof obj.text === 'string'
            ? obj.text
            : typeof obj.message === 'string'
              ? obj.message
              : typeof obj.response === 'string'
                ? obj.response
                : null;
      if (text && text.trim()) {
        return {
          confidence_level: 70,
          tool_calls: null,
          bubbles: [{ text: text.trim() }],
          status: null,
        };
      }
    }
  } catch {
    // Malformed JSON
  }

  return null;
}

function sanitizeJsonStrings(raw: string): string {
  let inString = false;
  let escaped = false;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
      } else if (ch === '\\') {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/**
 * What IrisesWeb does with a finished turn (`finishChatTurn`), minus hermes: the mood moves the
 * gauges, the read becomes the note, the hook joins the trail, and the clock advances a turn.
 * The rules themselves are the snapshot's `advanceAffect` and `pushHook`; this is the wiring.
 */
export function advanceTryState(
  state: TryState,
  envelope: Envelope,
  clock: Pick<ClockInfo, 'energy' | 'cycleLoad'>,
  nowMs: number,
): TryState {
  let next = state;
  const status = envelope.status;
  if (status) {
    next = advanceAffect(next, status, clock, nowMs);
    next = {
      ...next,
      intent: status.intent_mode,
      note: status.meta_prompt || next.note,
      hookTrail: pushHook(next.hookTrail, status.hook_kind),
    };
  }
  return { ...next, turns: next.turns + 1, at: nowMs };
}
