import { chunkMessages } from '../chats/analyse';
import type { Message } from '../chats/types';

export type Phase1Mode = 'chunked' | 'one-shot';

/**
 * How one chat reaches Phase 1. Chunked is the default because it fits any
 * model; one-shot sends the whole training transcript in a single call for a
 * model with a large context window, and no merge is needed.
 */
export function phase1Chunks(messages: Message[], mode: Phase1Mode = 'chunked'): Message[][] {
  return mode === 'one-shot' ? [messages] : chunkMessages(messages);
}
