import { afterEach, describe, expect, it, vi } from 'vitest';
import { complete, completeDetailed, completeLongForm, fitMessages, reasoningFor, requestCompletion } from '../src/lib/openrouter';

const original = globalThis.fetch;
const asks = [{ role: 'user' as const, content: 'hello' }];

function reply(body: unknown): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = original;
});

describe('completion response handling', () => {
  it('returns content and keeps the usage numbers', async () => {
    reply({
      choices: [{ message: { content: '  ok  ' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } },
    });
    const result = await completeDetailed({ key: 'sk-test', messages: asks });
    expect(result.content).toBe('ok');
    expect(result.usage).toEqual({ prompt: 10, completion: 5 });
    expect(result.reasoningTokens).toBe(2);
    expect(result.empty).toBeUndefined();
  });

  it('joins providers that return content as parts', async () => {
    reply({ choices: [{ message: { content: [{ text: 'one ' }, { text: 'two' }] } }] });
    await expect(complete({ key: 'sk-test', messages: asks })).resolves.toBe('one two');
  });

  it('explains an empty answer when reasoning used the whole budget', async () => {
    reply({
      choices: [{ message: { content: '', reasoning: 'thinking' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 900, completion_tokens: 24_000, completion_tokens_details: { reasoning_tokens: 24_000 } },
    });
    await expect(complete({ key: 'sk-test', messages: asks })).rejects.toThrow(/whole output budget on reasoning/i);
  });

  it('leaves the empty result inspectable instead of throwing from the low-level call', async () => {
    reply({
      choices: [{ message: { content: null }, finish_reason: 'length' }],
      usage: { prompt_tokens: 900, completion_tokens: 24_000, completion_tokens_details: { reasoning_tokens: 12_000 } },
    });
    const result = await requestCompletion({ key: 'sk-test', messages: asks });
    expect(result.content).toBe('');
    expect(result.empty?.retryable).toBe(true);
    expect(result.empty?.reason).toMatch(/reasoning/i);
  });

  it('surfaces an error object even when the HTTP status is 200', async () => {
    reply({ error: { message: 'upstream provider failed' }, choices: [] });
    await expect(complete({ key: 'sk-test', messages: asks })).rejects.toThrow('upstream provider failed');
  });

  it('sends the reasoning budget it is given', async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as typeof fetch;
    await complete({ key: 'sk-test', messages: asks, reasoning: { effort: 'low' } });
    expect(body.reasoning).toEqual({ effort: 'low' });
  });
});

describe('completeLongForm with a cut-off answer', () => {
  function scripted(replies: Array<{ content: string; finish_reason: string }>): Array<Record<string, unknown>> {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/models')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      const next = replies[Math.min(bodies.length - 1, replies.length - 1)];
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: next.content }, finish_reason: next.finish_reason }],
          usage: { prompt_tokens: 100, completion_tokens: 24_000 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    return bodies;
  }

  it('retries once, because a document that stops mid-section is worse than a second call', async () => {
    const bodies = scripted([
      { content: '## 1. Context\nhalf a report', finish_reason: 'length' },
      { content: '## 1. Context\nwhole report', finish_reason: 'stop' },
    ]);
    const result = await completeLongForm({ key: 'sk-test', messages: asks, model: 'deepseek/deepseek-v4.1-flash' });
    expect(result.content).toBe('## 1. Context\nwhole report');
    expect(result.truncated).toBeUndefined();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].temperature).toBe(0.2);
  });

  it('keeps the cut-off answer when the retry is cut off too, and flags it', async () => {
    const bodies = scripted([{ content: 'first attempt', finish_reason: 'length' }]);
    const result = await requestCompletion({ key: 'sk-test', messages: asks });
    expect(result.truncated?.reason).toMatch(/output limit/);
    const again = await completeLongForm({ key: 'sk-test', messages: asks });
    expect(again.content).toBe('first attempt');
    expect(again.truncated).toBeDefined();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
  });

  it('does not mark a complete answer as truncated', async () => {
    scripted([{ content: 'whole report', finish_reason: 'stop' }]);
    const result = await completeLongForm({ key: 'sk-test', messages: asks });
    expect(result.truncated).toBeUndefined();
  });
});

describe('reasoningFor', () => {
  function catalogue(data: unknown[]): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  }

  it('caps models that think by default, and leaves opt-in models alone', async () => {
    catalogue([
      { id: 'google/gemini-2.5-pro', context_length: 1_000_000, reasoning: { mandatory: true } },
      { id: 'openai/gpt-5', context_length: 400_000, reasoning: { mandatory: true, supported_efforts: ['high', 'medium', 'low', 'minimal'] } },
      { id: 'anthropic/claude-sonnet-4.5', context_length: 1_000_000, reasoning: { mandatory: false } },
    ]);
    await expect(reasoningFor('google/gemini-2.5-pro')).resolves.toEqual({ effort: 'low' });
    await expect(reasoningFor('openai/gpt-5')).resolves.toEqual({ effort: 'low' });
    await expect(reasoningFor('anthropic/claude-sonnet-4.5')).resolves.toBeUndefined();
  });

  it('does not break the build when the catalogue is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    await expect(reasoningFor('openai/gpt-5')).resolves.toBeUndefined();
  });
});

describe('fitMessages', () => {
  const big = (tag: string) => `${tag} start ${'x'.repeat(300_000)} ${tag} end`;

  it('leaves a call that already fits exactly alone', () => {
    const messages = [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: 'hello' }];
    expect(fitMessages(messages, 1_000)).toEqual(messages);
  });

  it('trims the middle of the longest message and keeps both ends', () => {
    const messages = [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: big('TASK') }];
    const fitted = fitMessages(messages, 200_000);
    const content = fitted[1].content;
    expect(content.length).toBeLessThanOrEqual(200_000);
    expect(content.startsWith('TASK start')).toBe(true);
    expect(content.endsWith('TASK end')).toBe(true);
    expect(content).toContain('omitted to fit the model context');
    expect(fitted[0].content).toBe('sys');
  });
});
