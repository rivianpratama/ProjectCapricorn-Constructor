import type { Message, Platform, RawChat } from './types';

const INVISIBLE = /[\u200B-\u200F\uFEFF\u202A-\u202E]/g;
const MEDIA = /<(?:Media|media) omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted/gi;

const WHATSAPP =
  /^\s*(?:\[)?(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})(?:,|\s)\s*(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*(?:AM|PM|am|pm))?)(?:\])?\s*(?:-\s*)?\s*(?:([^:]+):\s*(.*)|(.*))/i;
const LINE_BRACKET = /^\s*\[(\d{4}[/.]\d{1,2}[/.]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.*)$/;
const LINE_TAB = /^\s*(\d{4}[/.]\d{1,2}[/.]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|am|pm))?)\t([^\t]+)\t(.*)$/;
const LINE_SPACE =
  /^\s*(\d{4}[/.]\d{1,2}[/.]\d{1,2})(?:\([^)]*\)|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日)?[ T](\d{1,2}:\d{2}(?::\d{2})?)\s+([^:]{1,40}):\s*(.*)$/;

export function detectPlatform(text: string): Platform {
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 60);
  if (lines.some(line => LINE_BRACKET.test(line))) return 'line';
  if (lines.filter(line => LINE_TAB.test(line)).length >= 1) return 'line';
  if (lines.some(line => WHATSAPP.test(line))) return 'whatsapp';
  if (lines.filter(line => LINE_SPACE.test(line)).length >= 1) return 'line';
  return 'unknown';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(raw: string): string {
  const [a, b, c] = raw.split(/[/.]/).map(Number);
  let year: number;
  let month: number;
  let day: number;
  if (a > 31) {
    year = a;
    month = b;
    day = c;
  } else {
    year = c;
    day = a;
    month = b;
    if (b > 12) {
      month = a;
      day = b;
    }
  }
  if (year < 100) year += 2000;
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function clock(raw: string): string {
  let value = raw.trim().replace('.', ':');
  const suffix = /(am|pm)$/i.exec(value)?.[1]?.toLowerCase();
  value = value.replace(/\s*(am|pm)$/i, '');
  const [hRaw, mRaw, sRaw] = value.split(':');
  let hour = Number(hRaw);
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  return `${pad(hour)}:${pad(Number(mRaw ?? 0))}:${pad(Number(sRaw ?? 0))}`;
}

function timestamp(date: string, time: string): number {
  const value = Date.parse(`${date}T${time}`);
  return Number.isFinite(value) ? value : Date.now();
}

function clean(message: string): string {
  return message.replace(INVISIBLE, '').replace(MEDIA, match => `[${match.replace(/[<>]/g, '')}]`).trim();
}

interface Draft {
  date: string;
  time: string;
  sender: string | null;
  lines: string[];
}

export function parseChat(text: string, fileName = 'chat.txt'): RawChat {
  const body = text.replace(INVISIBLE, '').replace(/\r\n?/g, '\n');
  const platform = detectPlatform(body);
  const drafts: Draft[] = [];
  for (const line of body.split('\n')) {
    let match = WHATSAPP.exec(line);
    let date: string | null = null;
    let time: string | null = null;
    let sender: string | null = null;
    let message = '';
    if (match) {
      date = isoDate(match[1]);
      time = clock(match[2]);
      sender = match[3]?.trim() ?? null;
      message = match[3] ? match[4] ?? '' : match[5] ?? '';
    } else if ((match = LINE_BRACKET.exec(line))) {
      date = isoDate(match[1]);
      time = clock(match[2]);
      sender = match[3].trim();
      message = match[4];
    } else if ((match = LINE_TAB.exec(line))) {
      date = isoDate(match[1]);
      time = clock(match[2]);
      sender = match[3].trim();
      message = match[4];
    } else if ((match = LINE_SPACE.exec(line))) {
      date = isoDate(match[1]);
      time = clock(match[2]);
      sender = match[3].trim();
      message = match[4];
    }
    if (date && time) {
      drafts.push({ date, time, sender, lines: [message] });
    } else if (line.trim() && drafts.length) {
      drafts[drafts.length - 1].lines.push(line);
    }
  }

  const participants: string[] = [];
  const messages: Message[] = [];
  for (const draft of drafts) {
    const message = clean(draft.lines.join('\n'));
    if (!message) continue;
    const sender = draft.sender && draft.sender.length <= 80 ? draft.sender : 'System';
    if (sender !== 'System' && !participants.includes(sender)) participants.push(sender);
    messages.push({
      id: messages.length,
      date: draft.date,
      time: draft.time,
      timestamp: timestamp(draft.date, draft.time),
      sender,
      text: message,
    });
  }
  if (!messages.length) throw new Error('No messages found in this export.');
  if (!participants.length) throw new Error('No named participants found in this export.');
  return { fileName, platform, participants, messages };
}

export function rangeOf(messages: Message[]): { start: string; end: string } {
  const dates = messages.map(message => message.date).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}
