import { splitHoldout } from '../chats/analyse';
import type { Message } from '../chats/types';
import { phase1Chunks, type Phase1Mode } from '../pipeline/phase1';

export interface Usage {
  input: number;
  output: number;
}

export interface Estimate {
  /** Per-chat engrams and merges. */
  bulk: Usage;
  /** Report, questions and soul. */
  strong: Usage;
}

/** Fixed prompt sizes in tokens (the prompts/*.md files at about 4 bytes per token) and typical output sizes. */
const PROMPT = { phase1: 3800, merge: 400, phase2: 2400, phase3a: 320, phase3b: 1400 };
const OUT = { engram: 4000, report: 5000, questions: 1500, soul: 9000 };
const BASE_SLOTS = 6000;
const HEADER = 150;

/** Rough token count: about 4 characters per token for Latin text, one per character for everything else. */
export function textTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii += 1;
    else wide += 1;
  }
  return Math.ceil(ascii / 4 + wide);
}

export function messageTokens(messages: Message[]): number {
  let total = 0;
  for (const message of messages) total += textTokens(message.text) + 14;
  return total;
}

/** Tokens for the whole build, from the chat ranges as they will be sent. Approximate by design. */
export function estimateRun(chats: Message[][], mode: Phase1Mode = 'one-shot'): Estimate {
  const bulk: Usage = { input: 0, output: 0 };
  const strong: Usage = { input: 0, output: 0 };

  for (const messages of chats) {
    const { training } = splitHoldout(messages);
    if (mode === 'agentic') {
      const tokens = messageTokens(training);
      bulk.input += Math.round(tokens * 0.35 + 40_000);
      bulk.output += OUT.engram;
    } else {
      const chunks = phase1Chunks(training, mode);
      for (const chunk of chunks) {
        bulk.input += PROMPT.phase1 + HEADER + messageTokens(chunk);
        bulk.output += OUT.engram;
      }
      if (chunks.length > 1) {
        bulk.input += PROMPT.merge + chunks.length * OUT.engram;
        bulk.output += OUT.engram;
      }
    }
  }

  const n = chats.length;
  strong.input += PROMPT.phase2 + n * (OUT.engram + HEADER);
  strong.output += OUT.report;
  strong.input += PROMPT.phase3a + OUT.report;
  strong.output += OUT.questions;
  strong.input += PROMPT.phase3b + OUT.report + OUT.questions + BASE_SLOTS;
  strong.output += OUT.soul;

  return { bulk, strong };
}

export interface Price {
  promptPrice: number | null;
  completionPrice: number | null;
}

/** USD, or null when either model's price is unknown. */
export function estimateCost(estimate: Estimate, bulk?: Price, strong?: Price): number | null {
  const part = (usage: Usage, price?: Price): number | null =>
    price && price.promptPrice !== null && price.completionPrice !== null
      ? (usage.input * price.promptPrice + usage.output * price.completionPrice) / 1_000_000
      : null;
  const a = part(estimate.bulk, bulk);
  const b = part(estimate.strong, strong);
  return a === null || b === null ? null : a + b;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${+(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${+(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function formatCost(usd: number): string {
  if (usd === 0) return 'free';
  if (usd < 0.01) return '<$0.01';
  return `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`;
}
