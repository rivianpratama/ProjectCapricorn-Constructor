import { describe, expect, it } from 'vitest';
import type { Message } from '../src/lib/chats/types';
import { phase1Chunks } from '../src/lib/pipeline/phase1';

const chat = (count: number): Message[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    date: '2024-01-01',
    time: '10:00',
    timestamp: i,
    sender: i % 2 ? 'A' : 'B',
    text: 'hello there, how are you today',
  }));

describe('phase 1 modes', () => {
  it('sends the whole chat in one shot by default', () => {
    const messages = chat(2500);
    const chunks = phase1Chunks(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(messages);
  });

  it('chunks a long chat when chunked mode is selected', () => {
    const messages = chat(2500);
    const chunks = phase1Chunks(messages, 'chunked');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toHaveLength(1200);
    expect(chunks.at(-1)?.at(-1)?.id).toBe(2499);
  });

  it('treats a chat that already fits one chunk the same in both modes', () => {
    const messages = chat(100);
    expect(phase1Chunks(messages, 'one-shot')).toEqual(phase1Chunks(messages, 'chunked'));
  });
});
