import { chunkMessages } from '../chats/analyse';
import type { Message } from '../chats/types';

export type Phase1Mode = 'one-shot' | 'agentic' | 'chunked';

/**
 * How one chat reaches Phase 1. One-shot is the default method; agentic is the
 * experimental context-managed mode; chunked splits the transcript into
 * 1,200-message windows with a merge pass.
 */
export function phase1Chunks(messages: Message[], mode: Phase1Mode = 'one-shot'): Message[][] {
  return mode === 'chunked' ? chunkMessages(messages) : [messages];
}
