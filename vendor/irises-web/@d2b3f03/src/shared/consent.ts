import { cleanBubble } from './envelope';
import type { DelegateArgs, Delegation, PendingAsk } from './types';

const ACT_VERBS = /^(?:please\s+|go\s+ahead\s+and\s+|can\s+you\s+)?(?:send|email|reply\s+to|message|text|post|tweet|publish|buy|order|purchase|pay|transfer|book|reserve|rsvp|sign\s+up|register|submit|unsubscribe|cancel|delete|remove)\b/i;

/** The request is a distilled imperative, so the side effect shows up in its leading verb. */
export function isSideEffect(request: string): boolean {
  return ACT_VERBS.test(request.trim());
}

export const PENDING_TTL_MS = 10 * 60 * 1000;

export function livePending(p: PendingAsk | null, now: number): PendingAsk | null {
  return p && now - p.at < PENDING_TTL_MS ? p : null;
}

export type ConsentDecision =
  | { action: 'proceed'; task: Delegation }
  | { action: 'park'; by: 'model' | 'lexicon'; task: Delegation };

export function consentDecision(args: DelegateArgs, pending: PendingAsk | null): ConsentDecision {
  if (args.approved && pending) {
    return { action: 'proceed', task: { request: pending.request, kind: pending.kind, brief: pending.brief, effect: 'act', approved: true } };
  }
  const task: Delegation = { request: args.request, kind: args.kind, brief: args.meta_prompt, effect: args.effect, approved: args.approved === true };
  if (args.effect === 'act') return { action: 'park', by: 'model', task };
  if (isSideEffect(args.request)) return { action: 'park', by: 'lexicon', task: { ...task, effect: 'act' } };
  return { action: 'proceed', task };
}

/**
 * Irises' code fallback (sideEffects.ts), em dash removed. The request is the model's own words and
 * becomes her bubble, so it goes through the same bubble cleaner and loses its closing punctuation.
 */
export function consentLine(request: string): string {
  const r = cleanBubble(request).replace(/[\s.?!,;:]+$/, '') || 'go ahead';
  return `wait before i do it, you want me to ${r.charAt(0).toLowerCase()}${r.slice(1)}? say go and i go`;
}
