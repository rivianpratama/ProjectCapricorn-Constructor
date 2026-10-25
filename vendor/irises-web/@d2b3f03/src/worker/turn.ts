import { advanceAffect } from '../shared/affect';
import { FLOOR_LINE } from '../shared/canned';
import { compileAffect, demoFace, renderDirective } from '../shared/compile';
import { consentDecision, livePending } from '../shared/consent';
import { familiarityOf } from '../shared/familiarity';
import { pushHook, quietForced } from '../shared/hooks';
import type {
  AffectState, Bubble, ClockInfo, Delegation, Envelope, StateEvent, Status, TurnInfo,
} from '../shared/types';
import type { TailInput } from './prompt/tail';
import { isCrisis } from './safety';
import { signTicket } from './session';

export function floorEnvelope(): Envelope {
  return { confidence_level: 0, tool_calls: null, bubbles: [{ text: FLOOR_LINE }], status: null };
}

export function planTurn(i: {
  state: AffectState; clock: ClockInfo; tz: string; text: string; lastCredit: boolean; now: number; cutOff?: number;
}): { turnInfo: TurnInfo; tail: TailInput } {
  const familiarity = familiarityOf(i.state.turns);
  const d = demoFace(compileAffect(i.state, i.clock, familiarity.band));
  const directives = renderDirective(d, i.state);
  const pending = livePending(i.state.pending, i.now);
  const safety = isCrisis(i.text);
  // The hook kill switch never silences a crisis reply or the last-credit notice: both need
  // room to say something, and "one plain short bubble, or nothing" would contradict them.
  const quiet = !safety && !i.lastCredit && quietForced(i.state.hookTrail);
  const must = (safety ? 1 : 0) + (i.lastCredit ? 1 : 0);
  const bubbleCap: 1 | 2 | 3 = quiet ? 1 : must === 0 ? d.bubbleCap : must === 1 ? (Math.max(d.bubbleCap, 2) as 2 | 3) : 3;
  return {
    turnInfo: {
      directives, looseness: d.looseness, bubbleCap, clock: i.clock, familiarity, masked: d.masked,
      quietForced: quiet, lastCredit: i.lastCredit, pending: pending !== null, safety,
    },
    tail: {
      clockLabel: i.clock.label, tz: i.tz, directiveLines: directives, looseness: d.looseness, bubbleCap,
      pending, quietForced: quiet, safety, lastCredit: i.lastCredit, cutOff: i.cutOff ?? 0, text: i.text,
      voiceSeed: Math.floor(i.now / 60_000), firstTurn: i.state.turns === 0,
    },
  };
}

export async function finishChatTurn(i: {
  envelope: Envelope; state: AffectState; clock: ClockInfo; now: number; sid: string; turn: number; secret: string;
}): Promise<StateEvent> {
  const { envelope, clock, now } = i;
  let next: AffectState = i.state;
  const s = envelope.status;
  if (s) {
    next = advanceAffect(next, s, clock, now);
    next = {
      ...next,
      intent: s.intent_mode,
      note: s.meta_prompt || next.note,
      hookTrail: pushHook(next.hookTrail, s.hook_kind),
    };
  }
  next = { ...next, turns: next.turns + 1, at: now };

  let pending = livePending(next.pending, now);
  let ticket: string | null = null;
  let parked: StateEvent['parked'] = null;
  let delegation: Delegation | null = null;
  const callArgs = envelope.tool_calls?.[0]?.args;
  if (callArgs) {
    const decision = consentDecision(callArgs, pending);
    delegation = decision.task;
    if (decision.action === 'proceed') {
      // Only the approved re-issue settles the parked ask. A fresh read while an act is
      // parked leaves it waiting, as the tail tells her ("Anything else: it stays parked").
      if (callArgs.approved && pending) pending = null;
      ticket = await signTicket(i.secret, i.sid, i.turn, decision.task.request, now);
    } else {
      parked = decision.by;
      pending = { request: decision.task.request, kind: decision.task.kind, brief: decision.task.brief, at: now };
    }
  }
  return { state: { ...next, pending }, envelope, ticket, parked, delegation };
}

export function finishComposeTurn(i: {
  composed: { bubbles: Bubble[]; status: Partial<Status> }; state: AffectState; clock: ClockInfo; now: number;
}): { state: AffectState; envelope: Envelope } {
  const s = i.composed.status;
  let next = i.state;
  if (s.mood_label) {
    next = advanceAffect(next, { mood_label: s.mood_label, mood_shift: s.mood_shift ?? 'steady', epistemic_trigger: 'none' }, i.clock, i.now);
  }
  if (s.meta_prompt) next = { ...next, note: s.meta_prompt };
  next = { ...next, delegations: next.delegations + 1, at: i.now };
  return { state: next, envelope: { confidence_level: 100, tool_calls: null, bubbles: i.composed.bubbles, status: null } };
}
