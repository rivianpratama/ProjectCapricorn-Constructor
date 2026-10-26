import { describe, expect, it } from 'vitest';
import type { Message } from '../src/lib/chats/types';
import { estimateCost, estimateRun, formatCost, formatTokens, textTokens } from '../src/lib/client/estimate';

const chat = (count: number): Message[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    date: '2024-01-01',
    time: '10:00',
    timestamp: i,
    sender: i % 2 ? 'A' : 'B',
    text: 'hello there, how are you today',
  }));

describe('estimate', () => {
  it('counts latin at ~4 chars per token and wide chars at one', () => {
    expect(textTokens('abcd')).toBe(1);
    expect(textTokens('こんにちは')).toBe(5);
  });

  it('grows with chat size and adds merge calls for chunked chats', () => {
    const small = estimateRun([chat(100)], 'chunked');
    const big = estimateRun([chat(5000)], 'chunked');
    expect(big.bulk.input).toBeGreaterThan(small.bulk.input);
    expect(big.bulk.output).toBeGreaterThan(small.bulk.output);
  });

  it('charges one call and no merge when phase 1 is one-shot (default)', () => {
    const chunked = estimateRun([chat(5000)], 'chunked');
    const oneShot = estimateRun([chat(5000)], 'one-shot');
    expect(oneShot.bulk.input).toBeLessThan(chunked.bulk.input);
    expect(oneShot.bulk.output).toBeLessThan(chunked.bulk.output);
    expect(estimateRun([chat(5000)])).toEqual(oneShot);
  });

  it('matches the chunked estimate when a chat already fits one chunk', () => {
    expect(estimateRun([chat(100)], 'one-shot')).toEqual(estimateRun([chat(100)], 'chunked'));
  });

  it('grows with the number of chats', () => {
    expect(estimateRun([chat(100), chat(100)]).strong.input).toBeGreaterThan(estimateRun([chat(100)]).strong.input);
  });

  it('prices both roles, and gives null when a price is unknown', () => {
    const run = estimateRun([chat(100)]);
    const cost = estimateCost(run, { promptPrice: 1, completionPrice: 2 }, { promptPrice: 3, completionPrice: 6 });
    expect(cost).toBeGreaterThan(0);
    expect(estimateCost(run, { promptPrice: null, completionPrice: null }, { promptPrice: 3, completionPrice: 6 })).toBeNull();
    expect(estimateCost(run, undefined, undefined)).toBeNull();
  });

  it('formats', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(120_000)).toBe('120k');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0.42)).toBe('$0.42');
    expect(formatCost(0)).toBe('free');
  });
});
