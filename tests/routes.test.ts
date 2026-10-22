import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyse } from '../src/lib/chats/analyse';
import type { Message } from '../src/lib/chats/types';
import { POST as tryPost } from '../app/api/try/route';
import { POST as phase1Post } from '../app/api/phase1/route';
import { POST as composePost } from '../app/api/compose/route';

const engram = readFileSync(join(import.meta.dirname, 'fixtures', 'engram.md'), 'utf8');
const soul = readFileSync(join(import.meta.dirname, 'fixtures', 'soul.md'), 'utf8');
const report = readFileSync(join(import.meta.dirname, 'fixtures', 'report.md'), 'utf8');
const original = globalThis.fetch;

interface Sent {
  url: string;
  body: { messages: Array<{ role: string; content: string }> };
}

function mockReply(content: string): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return sent;
}

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openrouter-key': 'sk-test' },
    body: JSON.stringify(body),
  });
}

function messages(): Message[] {
  const lines = [
    'it was so good',
    'i got the weird menu thing',
    'wkwk fair',
    'not the boss AGAIN',
    'u sure tho',
    'i never said that',
  ];
  return lines.map((text, id) => ({
    id,
    date: '2024-03-12',
    time: `21:0${id}:00`,
    timestamp: Date.UTC(2024, 2, 12, 21, id),
    sender: id % 2 ? 'Raka' : 'Nadia',
    text,
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = original;
});

describe('phase 1 route', () => {
  it('accepts a schema-shaped engram whose quotes are real', async () => {
    const chat = messages();
    mockReply(engram);
    const response = await phase1Post(
      request('/api/phase1', {
        chat: 'chat-1',
        relationship: 'close friend',
        subject: 'Nadia',
        messages: chat,
        stats: analyse(chat, 'Nadia'),
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { engram: { findings: unknown[]; exemplars: unknown[] } };
    expect(data.engram.findings.length).toBeGreaterThanOrEqual(5);
    expect(data.engram.exemplars.length).toBeGreaterThanOrEqual(9);
  });

  it('rejects a quoted line that is not in the transcript', async () => {
    const chat = messages();
    mockReply(engram.replace('i never said that', 'i never said anything'));
    const response = await phase1Post(
      request('/api/phase1', {
        chat: 'chat-1',
        relationship: 'close friend',
        subject: 'Nadia',
        messages: chat,
        stats: analyse(chat, 'Nadia'),
      }),
    );
    expect(response.status).toBe(502);
    const data = (await response.json()) as { error: string };
    expect(data.error).toMatch(/quote not found/);
  });
});

describe('compose route', () => {
  it('renders a whole pack from a soul and keeps the machinery', async () => {
    mockReply(soul);
    const response = await composePost(
      request('/api/compose', {
        report,
        answers: { name: 'Iris', relationship: 'Close friend', rename: 'No' },
        n: 2,
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { files: Array<{ path: string; source: string }>; issues: unknown[] };
    expect(data.issues).toEqual([]);
    const paths = data.files.map(file => file.path);
    expect(paths).toContain('soul-pack/irises/src/persona/policy.ts');
    expect(paths).toContain('soul-pack/irises-web/src/worker/prompt/voice.ts');
    expect(paths).toContain('soul-pack/SOUL.md');
    expect(paths).toContain('soul-pack/ENGRAM_REPORT.md');
    expect(paths).toContain('soul-pack/APPLY.md');
    const voice = data.files.find(file => file.path.endsWith('worker/prompt/voice.ts'))!;
    expect(voice.source).toContain('export function voiceSamplesFor');
    expect(voice.source).toContain('export const SAMPLE_COUNT = 6;');

    const files = Object.fromEntries(data.files.map(file => [file.path, file.source]));
    const sent = mockReply(JSON.stringify({ bubbles: [{ text: 'hey' }], status: {} }));
    const tried = await tryPost(request('/api/try', { files, text: 'you around?', history: [] }));
    expect(tried.status).toBe(200);
    expect(sent[0].body.messages[0].content).toContain('You are Iris, texting like a close friend');
    expect(sent[0].body.messages[1].content).toContain('<their_message>you around?</their_message>');
  });
});

describe('try route', () => {
  it('frames the turn and returns the bubbles', async () => {
    const sent = mockReply(JSON.stringify({ bubbles: [{ text: 'wait' }, { text: 'tell me everything' }], status: {} }));
    const response = await tryPost(
      request('/api/try', { files: {}, text: 'i got the job', history: [] }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { bubbles: string[] };
    expect(data.bubbles).toEqual(['wait', 'tell me everything']);

    const [call] = sent;
    expect(call.url).toContain('openrouter.ai');
    expect(call.body.messages[0].content).toContain('## Who you are');
    expect(call.body.messages[1].content).toContain('<their_message>i got the job</their_message>');
    expect(call.body.messages[1].content).toContain('<prompt>');
  });

  it('surfaces an unreadable model reply as an error', async () => {
    mockReply('not json at all');
    const response = await tryPost(request('/api/try', { files: {}, text: 'hello', history: [] }));
    expect(response.status).toBe(502);
  });
});
