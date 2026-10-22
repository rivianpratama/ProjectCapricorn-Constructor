import type { HistoryItem } from '../../shared/types';
import { SYSTEM_PROMPT } from './system';

export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** Her empty turn: what stands between two messages of theirs that got no reply. */
const NO_REPLY = '...';

/**
 * The history as alternating turns. Each request must start with the previous request's messages,
 * byte for byte, so the provider's prefix cache covers everything but the newest exchange. So two
 * messages of theirs in a row are never merged: when the first went unanswered, the last request
 * carried it followed by NO_REPLY (buildMessages), and this replays exactly that. Her own consecutive
 * runs (the holding reply, then the write-up of the look) still merge into one turn.
 *
 * Her past turns replay as plain lines, one bubble a line, not as JSON: the prompt carries no colon
 * (owner, 2026-10-07), and the provider's JSON mode still holds her new reply to the envelope.
 */
export function historyMessages(history: readonly HistoryItem[]): LlmMessage[] {
  const out: { role: 'user' | 'assistant'; texts: string[] }[] = [];
  for (const h of history) {
    const last = out[out.length - 1];
    if (h.role === 'assistant') {
      if (last?.role === 'assistant') last.texts.push(...h.bubbles);
      else out.push({ role: 'assistant', texts: [...h.bubbles] });
      continue;
    }
    if (last?.role === 'user') out.push({ role: 'assistant', texts: [] });
    out.push({ role: 'user', texts: [h.text] });
  }
  return out.map(m => ({ role: m.role, content: m.texts.length ? m.texts.join('\n') : NO_REPLY }));
}

export function buildMessages(history: readonly HistoryItem[], tail: string): LlmMessage[] {
  const past = historyMessages(history);
  if (past.length && past[past.length - 1].role === 'user') {
    past.push({ role: 'assistant', content: NO_REPLY });
  }
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...past, { role: 'user', content: tail }];
}
