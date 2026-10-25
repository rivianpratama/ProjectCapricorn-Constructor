import type { Message } from '../chats/types';

/**
 * Quote verification. Phase 1 has to prove every finding against the transcript, and a quote is
 * only "not in the transcript" when the subject's words really are not there. Models quote in
 * shapes the words still satisfy: several bubbles joined with `/`, media and location markers
 * left in or left out, a `Speaker:` prefix, escaped quotes, the wrong capitalisation. Each of
 * those counts as found; only a quote whose words appear nowhere in the subject's messages fails.
 */

/** A media or location marker the contact wrote around, never something the subject typed. */
const PLACEHOLDER = /\[[^\]\n]{0,40}\]|\s*<(media|location|attached|sticker|image|video|audio)[^>]*>/gi;
const QUOTE_CHARS = /[“”„‟«»‹›]/g;
const APOSTROPHES = /[‘’‛`´]/g;
const BUBBLE_BREAK = /\s+\/\s+/;

/** Letters and digits only, lowercased: the words a quote is made of, with nothing around them. */
export function words(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(QUOTE_CHARS, '"')
    .replace(APOSTROPHES, "'")
    .replace(PLACEHOLDER, ' ')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same, with the speaker label some models put in front of a quote removed. */
function withoutSpeaker(text: string): string {
  return text.replace(/^[^\s:/]{1,24}:\s+/, '').replace(/^[^\s]{1,24}:\s+/, '');
}

/**
 * The forms a quote may take, most literal first: as written, without its quotes, without a
 * speaker label, and finally the space-separated words it is made of.
 */
function forms(quote: string): string[] {
  const trimmed = quote.trim();
  const out = [
    trimmed,
    trimmed.replace(/^["'“”«»]+|["'“”«»]+$/g, '').trim(),
    trimmed.replace(/\\(["'“”])/g, '$1'),
    withoutSpeaker(trimmed),
  ].map(form => form.trim());
  const spaced = words(trimmed);
  if (spaced) out.push(spaced);
  return [...new Set(out.filter(Boolean))];
}

/** Does one bubble sit inside the transcript, as written or as a run of the same words? */
function bubbleFound(bubble: string, transcript: string, spaced: string, messages: Message[]): boolean {
  if (forms(bubble).some(form => transcript.includes(form))) return true;
  const anchor = words(bubble);
  if (!anchor) return false;
  if (spaced.includes(anchor)) return true;
  return messages.some(message => words(message.text).includes(anchor));
}

/**
 * A multi-bubble quote counts when at least half its bubbles are in the transcript. One bubble
 * may be a sticker, a gap or a paraphrase among several real words; most of them cannot be.
 */
export function isQuoteInTranscript(quote: string, transcript: string, messages: Message[]): boolean {
  if (!quote?.trim()) return false;
  const spacedTranscript = words(transcript);
  if (bubbleFound(quote, transcript, spacedTranscript, messages)) return true;

  const bubbles = quote
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .split(BUBBLE_BREAK)
    .map(bubble => bubble.trim())
    .filter(bubble => words(bubble).length >= 2);
  if (bubbles.length < 2) return false;
  if (bubbles.some(bubble => words(bubble) === words(quote))) return false;
  const found = bubbles.filter(bubble => bubbleFound(bubble, transcript, spacedTranscript, messages)).length;
  return found / bubbles.length >= 0.5;
}

export interface Evidence {
  total: number;
  verified: number;
  /** The first few quotes that matched nothing, for the error message and the repair prompt. */
  missing: string[];
}

/** One pass over every quote in the engram's findings; found quotes are kept on the finding. */
export function verifyEvidence(findings: Array<{ quotes: string[] }>, messages: Message[]): Evidence {
  const transcript = messages.map(message => message.text).join('\n');
  let total = 0;
  let verified = 0;
  const missing: string[] = [];

  for (const finding of findings) {
    const kept: string[] = [];
    for (const quote of finding.quotes) {
      total += 1;
      if (isQuoteInTranscript(quote, transcript, messages)) {
        verified += 1;
        kept.push(quote);
      } else {
        missing.push(quote);
      }
    }
    finding.quotes = kept;
  }
  return { total, verified, missing };
}
