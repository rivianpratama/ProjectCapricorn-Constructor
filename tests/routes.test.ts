import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyse } from '../src/lib/chats/analyse';
import type { Message } from '../src/lib/chats/types';
import { MODELS } from '../src/lib/openrouter';
import { POST as tryPost } from '../app/api/try/route';
import { POST as phase1Post } from '../app/api/phase1/route';
import { POST as phase2Post } from '../app/api/phase2/route';
import { POST as composePost } from '../app/api/compose/route';
import { POST as mergePost } from '../app/api/phase1-merge/route';

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

  it('drops bad findings when at least 80% of quotes check out', async () => {
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
    expect(response.status).toBe(200);
    const data = (await response.json()) as { engram: { findings: Array<{ id: string }> } };
    expect(data.engram.findings.some(f => f.id === 'taken-seriously')).toBe(false);
    expect(data.engram.findings.length).toBe(4);
  });

  it('keeps the findings a lower quote pass rate still proves, instead of failing the chat', async () => {
    const chat = messages();
    // Two quotes that were never said, the rest exact: 80% was the rule, and a model cannot
    // count to 80% of its own output.
    const twoStale = engram
      .replace('i never said that', 'i never said anything')
      .replace('u sure tho', 'are you totally sure tho');
    mockReply(twoStale);
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
    const data = (await response.json()) as { engram: { findings: Array<{ quotes: string[] }> } };
    expect(data.engram.findings.length).toBeGreaterThan(0);
    const quotes = data.engram.findings.flatMap(finding => finding.quotes);
    expect(quotes).not.toContain('i never said anything');
  });

  it('asks once for quotes that are really missing, and names them', async () => {
    const chat = messages();
    const invented = engram.replace(/quotes: "[^"]*"(?: "[^"]*")*/g, 'quotes: "this was never typed"');
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      // The reasoning check reads the catalogue first; it is not a completion.
      if (String(input).includes('/models')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { messages: Array<{ role: string; content: string }> };
      bodies.push(parsed);
      return new Response(JSON.stringify({ choices: [{ message: { content: invented }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const response = await phase1Post(
      request('/api/phase1', {
        chat: 'chat-1',
        relationship: 'close friend',
        subject: 'Nadia',
        messages: chat,
        stats: analyse(chat, 'Nadia'),
      }),
    );
    expect(bodies).toHaveLength(2);
    const repair = bodies[1].messages.find(message => message.content.startsWith('Your previous response failed validation'));
    expect(repair?.content).toMatch(/were not found in the transcript/);
    expect(repair?.content).toMatch(/"this was never typed"/);
    expect(response.status).toBe(502);
    const data = (await response.json()) as { error: string };
    expect(data.error).toMatch(/every quote in the engram was missing from the transcript/);
  });
});

describe('phase 1 route with no findings', () => {
  it('accepts an engram whose probes are all Not observed with receipts', async () => {
    const onlyReceipts = engram
      .replace(/^- id: .*$/gm, '')
      .replace(/^## 4\. Emotion/m, "## 4. Emotion\nNot observed (searched: \"maaf\", \"sorry\").");
    mockReply(onlyReceipts);
    const chat = messages();
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
    const data = (await response.json()) as { engram: { findings: unknown[] } };
    expect(data.engram.findings).toHaveLength(0);
  });

  it('names the dropped finding lines when nothing survives the parser, after one retry', async () => {
    // The model keeps the quotes but loses frequency, scope and confidence: the silent drop that
    // used to read as "the engram carried no tagged findings".
    mockReply(engram.replace(/frequency: \w+(, )?|confidence: \w+(, )?|scope: [^,\n]+(, )?/g, ''));
    const chat = messages();
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
    const data = (await response.json()) as { error: string; id: string };
    expect(data.error).toMatch(/no findings the parser could keep \(\d+ written\): finding has no usable/);
    expect(data.error).toMatch(/\(after one retry\)/);
    expect(data.id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  });

  it('says plainly when no line follows the finding shape at all', async () => {
    mockReply(engram.replace(/- id: .*$/gm, '').replace(/Not observed \(searched: [^)]*\)/g, ''));
    const chat = messages();
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
    expect(data.error).toMatch(/no line followed the finding shape/);
  });
});

describe('phase 2 route', () => {
  it('retries once when reasoning leaves no answer', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/models')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '', reasoning: 'thinking' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 1000, completion_tokens: 24_000, completion_tokens_details: { reasoning_tokens: 24_000 } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: report }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 5000 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const chat = messages();
    const response = await phase2Post(
      request('/api/phase2', {
        chats: [{ chat: 'chat-1', relationship: 'close friend', subject: 'Nadia', engram, stats: analyse(chat, 'Nadia') }],
      }),
    );
    expect(response.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].reasoning).toEqual({ effort: 'minimal' });
    const data = (await response.json()) as { report: { drives: unknown[] } };
    expect(data.report.drives.length).toBeGreaterThan(0);
  });

  it('caps reasoning on a model that thinks by default', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: MODELS.strong, name: 'Strong', context_length: 1_000_000, reasoning: { mandatory: true } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: report }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 5000 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const chat = messages();
    const response = await phase2Post(
      request('/api/phase2', {
        chats: [{ chat: 'chat-1', relationship: 'close friend', subject: 'Nadia', engram, stats: analyse(chat, 'Nadia') }],
      }),
    );
    expect(response.status).toBe(200);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].reasoning).toEqual({ effort: 'low' });
  });

  it('asks for the report again when it comes back in a shape the parser refuses', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/models')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      calls += 1;
      // The first answer is prose with no headings, the shape that used to fail the whole run.
      const content = calls === 1 ? 'Here is my analysis of the psyche. It is long and not structured.' : report;
      return new Response(
        JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 5000 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const chat = messages();
    const response = await phase2Post(
      request('/api/phase2', {
        chats: [{ chat: 'chat-1', relationship: 'close friend', subject: 'Nadia', engram, stats: analyse(chat, 'Nadia') }],
      }),
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    const data = (await response.json()) as { markdown: string; report: { drives: unknown[] } };
    expect(data.markdown).toBe(report.trim());
    expect(data.report.drives.length).toBeGreaterThan(0);
  });

  it('gives up with a readable reason and a request id when the retry is malformed too', async () => {
    mockReply('Still prose, still no headings.');
    const chat = messages();
    const response = await phase2Post(
      request('/api/phase2', {
        chats: [{ chat: 'chat-1', relationship: 'close friend', subject: 'Nadia', engram, stats: analyse(chat, 'Nadia') }],
      }),
    );
    expect(response.status).toBe(502);
    const data = (await response.json()) as { error: string; id: string };
    expect(data.error).toMatch(/report needs 11 sections, found 0 \(no numbered headings\) \(after one retry\)/);
    expect(data.id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  });

  it('rejects a chat with no engram before calling the model', async () => {
    const sent = mockReply(report);
    const chat = messages();
    const response = await phase2Post(
      request('/api/phase2', {
        chats: [{ chat: 'chat-1', relationship: 'close friend', subject: 'Nadia', engram: '', stats: analyse(chat, 'Nadia') }],
      }),
    );
    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
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

describe('phase 1-merge route', () => {
  it('rejects a merge that kept no findings, naming what was dropped, after one retry', async () => {
    // A merge that keeps the quotes but loses the labels: what Phase 2 would build a ledger from.
    mockReply(engram.replace(/frequency: \w+(, )?|confidence: \w+(, )?|scope: [^,\n]+(, )?/g, ''));
    const response = await mergePost(request('/api/phase1-merge', { chat: 'chat-1', engrams: [engram, engram] }));
    expect(response.status).toBe(502);
    const data = (await response.json()) as { error: string; id: string };
    expect(data.error).toMatch(/the merged engram carried no findings: the parser could not keep/);
    expect(data.id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  });

  it('accepts a merge whose probes are all Not observed with receipts', async () => {
    mockReply(engram.replace(/^- id: .*$/gm, '').replace(/^## 4\. Emotion/m, '## 4. Emotion\nNot observed (searched: "maaf").'));
    const response = await mergePost(request('/api/phase1-merge', { chat: 'chat-1', engrams: [engram] }));
    expect(response.status).toBe(200);
  });
});

describe('compose route repair', () => {
  it('asks again with the reason when the soul will not parse, instead of failing the build', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      const content = calls === 1 ? 'Here is the soul, prose only.' : soul;
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const response = await composePost(request('/api/compose', { report, answers: {}, n: 1 }));
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    const data = (await response.json()) as { files: Array<{ path: string }> };
    expect(data.files.length).toBeGreaterThan(0);
  });

  it('fixes digits and dashes in code, with no second generation', async () => {
    let calls = 0;
    const slipped = soul.replace('You are Iris', 'You are Iris, 21, texting at 2am \u2014 mostly');
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: slipped }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const response = await composePost(request('/api/compose', { report, answers: {}, n: 1 }));
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    const data = (await response.json()) as { markdown: string; issues: unknown[] };
    expect(data.issues).toEqual([]);
    expect(data.markdown).toContain('twenty one');
    expect(data.markdown).not.toMatch(/\d/);
  });

  it('ships a soul with lint warnings instead of failing after the repair turns', async () => {
    let calls = 0;
    const stubborn = soul.replace('You are Iris', 'You are Iris, {name}');
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: stubborn }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const response = await composePost(request('/api/compose', { report, answers: {}, n: 1 }));
    expect(response.status).toBe(200);
    expect(calls).toBe(4);
    const data = (await response.json()) as { issues: Array<{ rule: string }>; files: unknown[] };
    expect(data.issues.some(issue => issue.rule === 'no-placeholder')).toBe(true);
    expect(data.files.length).toBeGreaterThan(0);
  });

  it('keeps the first soul when a repair turn fails to arrive', async () => {
    let calls = 0;
    const flawed = soul.replace('You are Iris', 'You are Iris, {name}');
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      calls += 1;
      if (calls > 1) return new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: flawed }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const response = await composePost(request('/api/compose', { report, answers: {}, n: 1 }));
    expect(response.status).toBe(200);
  });
});

describe('compose route transform', () => {
  it('rewrites a slot that kept Iris on its own, not with a whole-soul repair', async () => {
    const { baseSlots } = await import('../src/lib/soul/base');
    const { parseSoul, renderSoul } = await import('../src/lib/soul/parseSoul');
    const copied = renderSoul({ ...parseSoul(soul), 'web.how': baseSlots()['web.how'] });
    const fresh = '## How you write\n\n' + 'You type in quick lowercase bursts and drop a letter when you hurry. '.repeat(60);
    const systems: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      const sent = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      systems.push(sent.messages[0].content);
      const content = systems.length === 1 ? copied : '```text\n' + fresh + '\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const response = await composePost(request('/api/compose', { report, answers: {}, n: 1 }));
    expect(response.status).toBe(200);
    expect(systems[1]).toContain('transform one slot');
    const data = (await response.json()) as { markdown: string; issues: Array<{ rule: string }> };
    expect(data.issues.some(issue => issue.rule === 'copied-from-iris')).toBe(false);
    expect(data.markdown).toContain('quick lowercase bursts');
  });
});
