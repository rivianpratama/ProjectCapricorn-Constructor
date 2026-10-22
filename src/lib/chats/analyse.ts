import type { ChatStats, HeldOutPair, Message } from './types';

const EMOJI = /\p{Extended_Pictographic}/gu;
const LAUGH = /(wkwk+|haha+|hehe+|lol\b|lmao|anjir|anjay|awok)/gi;
const STRETCH = /(\p{L})\1{2,}/gu;
const PUNCT = /[!?.,;]{2,}/g;
const CAPS = /\b[A-Z]{2,}\b/;
const INDONESIAN = /\b(wkwk+|banget|gak|nggak|udah|bisa|aja|sih|deh|kok|gimana|kenapa|aku|kamu|kita|iya|bang|mas|mbak|anjir|anjay|gapapa|biasa aja|banget|ngga|dong|kan|lah)\b/i;
const STOPWORDS = new Set([
  'the','and','you','that','was','for','are','with','but','not','this','have','just','like','what','your','from','they','know','dont','didnt','im','its','u','i','a','to','of','in','it','is','so','on','my','me','we','be','no','do','if','at','or','as','up','out','about','really','very','too','can','will','would','could','got','get','go','going','one','all','now','then','than','them','she','he','his','her','him','our','us','there','here','when','how','why','who','which','some','more','much','also','been','were','had','has','had','oh','ok','okay','yeah','yes','no','nah','eh','ah','hmm','hmmm','lol','wkwk','haha','hehe','anjir','anjay','sih','deh','dong','kan','lah','ya','iya','aja','gak','nggak','udah','banget','kamu','aku','kita'
]);

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export function pseudonymise(messages: Message[], subject: string): Message[] {
  const others = [...new Set(messages.map(m => m.sender))]
    .filter(sender => sender !== subject && sender !== 'System')
    .sort();
  const labels = new Map<string, string>();
  others.forEach((sender, index) => labels.set(sender, `Person ${String.fromCharCode(65 + index)}`));
  return messages.map(message => ({
    ...message,
    sender: message.sender === subject ? subject : labels.get(message.sender) ?? 'System',
  }));
}

export function sliceRange(messages: Message[], start: string, end: string): Message[] {
  return messages.filter(message => message.date >= start && message.date <= end);
}

function top(counts: Map<string, number>, limit: number, min = 1): string[] {
  return [...counts.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function countInto(counts: Map<string, number>, value: string): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

export function analyse(messages: Message[], subject: string): ChatStats {
  const subjectMessages = messages.filter(message => message.sender === subject);
  const words = subjectMessages.map(message => message.text.split(/\s+/).filter(Boolean).length);
  const gaps: number[] = [];
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].sender === subject && messages[i - 1].sender !== subject) {
      const seconds = (messages[i].timestamp - messages[i - 1].timestamp) / 1000;
      if (seconds >= 0 && seconds < 60 * 60 * 6) gaps.push(seconds);
    }
  }
  const doubleTexts = subjectMessages.filter((message, index) => {
    const previous = subjectMessages[index - 1];
    const before = messages[messages.indexOf(message) - 1];
    return previous && before?.sender === subject && message.timestamp - before.timestamp < 10 * 60_000;
  }).length;
  const emojiCounts = new Map<string, number>();
  for (const message of subjectMessages) {
    for (const emoji of message.text.match(EMOJI) ?? []) {
      emojiCounts.set(emoji, (emojiCounts.get(emoji) ?? 0) + 1);
    }
  }
  const activeHours = Array.from({ length: 24 }, () => 0);
  for (const message of subjectMessages) activeHours[Number(message.time.slice(0, 2))] += 1;
  const withEmoji = subjectMessages.filter(message => EMOJI.test(message.text)).length;
  const initiations = subjectMessages.filter((message, index) => {
    if (index === 0) return false;
    const previous = messages[messages.indexOf(message) - 1];
    return previous && previous.sender !== subject && message.timestamp - previous.timestamp > 6 * 60 * 60_000;
  }).length;

  const chars = subjectMessages.map(message => message.text.length);
  const turns: number[] = [];
  for (const message of subjectMessages) {
    const previous = messages[messages.indexOf(message) - 1];
    if (previous?.sender === subject && turns.length) turns[turns.length - 1] += 1;
    else turns.push(1);
  }
  const conversations: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const next = messages[i + 1];
    if (!next || next.timestamp - messages[i].timestamp > 6 * 60 * 60_000) conversations.push(i);
  }
  const endsConversations = conversations.filter(index => messages[index]?.sender === subject).length;

  const laughCounts = new Map<string, number>();
  const stretchCounts = new Map<string, number>();
  const punctCounts = new Map<string, number>();
  const ngramCounts = new Map<string, number>();
  let caps = 0;
  let lowercaseStart = 0;
  let language = 0;
  let media = 0;
  let stickers = 0;
  let voiceNotes = 0;

  for (const message of subjectMessages) {
    for (const laugh of message.text.match(LAUGH) ?? []) countInto(laughCounts, laugh.toLowerCase());
    for (const stretch of message.text.match(STRETCH) ?? []) countInto(stretchCounts, stretch.toLowerCase());
    for (const run of message.text.match(PUNCT) ?? []) countInto(punctCounts, run);
    if (CAPS.test(message.text)) caps += 1;
    if (/^[a-z]/.test(message.text)) lowercaseStart += 1;
    if (INDONESIAN.test(message.text)) language += 1;
    if (/\[(?:media|image|video|gif|document)/i.test(message.text)) media += 1;
    if (/\[sticker/i.test(message.text)) stickers += 1;
    if (/\[audio/i.test(message.text)) voiceNotes += 1;
    const parts = tokens(message.text).filter(token => !STOPWORDS.has(token));
    for (let n = 2; n <= 4; n += 1) {
      for (let i = 0; i + n <= parts.length; i += 1) countInto(ngramCounts, parts.slice(i, i + n).join(' '));
    }
  }

  const slangCounts = new Map<string, number>();
  for (const message of subjectMessages) {
    for (const token of tokens(message.text)) {
      if (token.length > 1 && !STOPWORDS.has(token)) countInto(slangCounts, token);
    }
  }

  return {
    messages: messages.length,
    subjectMessages: subjectMessages.length,
    subjectShare: messages.length ? subjectMessages.length / messages.length : 0,
    medianWords: median(words),
    p90Words: percentile(words, 0.9),
    medianChars: median(chars),
    p90Chars: percentile(chars, 0.9),
    bubblesPerTurn: median(turns),
    p90Bubbles: percentile(turns, 0.9),
    questionRate: subjectMessages.length
      ? subjectMessages.filter(message => message.text.includes('?')).length / subjectMessages.length
      : 0,
    exclamationRate: subjectMessages.length
      ? subjectMessages.filter(message => message.text.includes('!')).length / subjectMessages.length
      : 0,
    emojiRate: subjectMessages.length ? withEmoji / subjectMessages.length : 0,
    laughRate: subjectMessages.length
      ? subjectMessages.filter(message => LAUGH.test(message.text)).length / subjectMessages.length
      : 0,
    laughTokens: top(laughCounts, 6),
    doubleTextShare: subjectMessages.length ? doubleTexts / subjectMessages.length : 0,
    initiations,
    conversations: conversations.length,
    endsConversations,
    medianReplySeconds: median(gaps),
    activeHours,
    topEmoji: [...emojiCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([emoji]) => emoji),
    capsRate: subjectMessages.length ? caps / subjectMessages.length : 0,
    lowercaseStartRate: subjectMessages.length ? lowercaseStart / subjectMessages.length : 0,
    stretchedWords: top(stretchCounts, 8),
    punctuationRuns: top(punctCounts, 8),
    languageMix: subjectMessages.length ? language / subjectMessages.length : 0,
    topSlang: top(slangCounts, 12, 2),
    topNgrams: top(ngramCounts, 8, 2),
    mediaCount: media,
    stickerCount: stickers,
    voiceNoteCount: voiceNotes,
  };
}

/** The latest slice is held out and never reaches Phase 1 or the n-gram index. */
export function splitHoldout(messages: Message[], share = 0.1): { training: Message[]; heldout: Message[] } {
  if (messages.length < 3) return { training: messages, heldout: [] };
  const cut = Math.max(1, Math.min(messages.length - 1, Math.floor(messages.length * (1 - share))));
  return { training: messages.slice(0, cut), heldout: messages.slice(cut) };
}

/** Chronological chunks with overlap, so a long chat still fits one Phase 1 call per chunk. */
export function chunkMessages(messages: Message[], size = 1200, overlap = 60): Message[][] {
  if (messages.length <= size) return [messages];
  const step = Math.max(1, size - overlap);
  const chunks: Message[][] = [];
  for (let start = 0; start < messages.length; start += step) {
    chunks.push(messages.slice(start, start + size));
    if (start + size >= messages.length) break;
  }
  return chunks;
}

export function heldOutPairs(messages: Message[], subject: string, count = 20): HeldOutPair[] {
  const candidates: HeldOutPair[] = [];
  let stimulus: string[] = [];
  let reply: string[] = [];
  let date = '';
  let id = 0;
  const flush = () => {
    if (stimulus.length && reply.length) {
      candidates.push({
        id: `pair-${id++}`,
        stimulus: stimulus.join('\n'),
        reply,
        date,
      });
    }
    stimulus = [];
    reply = [];
  };
  for (const message of messages) {
    if (message.sender === 'System') continue;
    if (message.sender === subject) {
      if (!reply.length) {
        if (!stimulus.length) continue;
        date = message.date;
      }
      reply.push(message.text);
    } else {
      if (reply.length) flush();
      stimulus.push(`${message.sender}: ${message.text}`);
      if (stimulus.length > 4) stimulus.shift();
    }
  }
  flush();
  if (candidates.length <= count) return candidates;
  const picked: HeldOutPair[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = Math.round((i * (candidates.length - 1)) / (count - 1));
    const pair = candidates[at];
    if (!picked.includes(pair)) picked.push(pair);
  }
  return picked;
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().replace(/[’]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? []).filter(Boolean);
}

export function ngramIndex(texts: string[], n = 4): Set<string> {
  const index = new Set<string>();
  for (const text of texts) {
    const parts = tokens(text);
    for (let i = 0; i + n <= parts.length; i += 1) index.add(parts.slice(i, i + n).join(' '));
  }
  return index;
}

export function overlapShare(text: string, index: Set<string>, n = 4): number {
  const parts = tokens(text);
  if (parts.length < n) return 0;
  let total = 0;
  let seen = 0;
  for (let i = 0; i + n <= parts.length; i += 1) {
    total += 1;
    if (index.has(parts.slice(i, i + n).join(' '))) seen += 1;
  }
  return total ? seen / total : 0;
}

export function openerDistinctness(replies: string[][]): number {
  const openers = replies.map(bubbles => (bubbles[0] ?? '').trim().toLowerCase()).filter(Boolean);
  if (!openers.length) return 0;
  return new Set(openers).size / openers.length;
}
