import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectPlatform, parseChat, rangeOf } from '../src/lib/chats/parse';
import { projectPath } from '../src/lib/soul/slots';

const wa = readFileSync(projectPath('tests', 'fixtures', 'whatsapp.txt'), 'utf8');
const line = readFileSync(projectPath('tests', 'fixtures', 'line.txt'), 'utf8');

describe('chat parser', () => {
  it('parses the WhatsApp export', () => {
    const chat = parseChat(wa, 'whatsapp.txt');
    expect(chat.platform).toBe('whatsapp');
    expect(chat.participants).toEqual(['Nadia', 'Raka']);
    expect(chat.messages).toHaveLength(11);
    expect(chat.messages[0]).toMatchObject({ date: '2024-03-12', time: '21:04:11', sender: 'Nadia' });
    expect(chat.messages[0].text).toBe('okay so i finally tried that place');
    expect(chat.messages[6].text).toBe('[Media omitted]');
  });

  it('parses the LINE export', () => {
    const chat = parseChat(line, 'line.txt');
    expect(chat.platform).toBe('line');
    expect(chat.participants).toEqual(['Raka', 'Nadia']);
    expect(chat.messages).toHaveLength(4);
    expect(rangeOf(chat.messages)).toEqual({ start: '2024-03-12', end: '2024-03-12' });
  });

  it('detects platform from the first lines', () => {
    expect(detectPlatform(wa)).toBe('whatsapp');
    expect(detectPlatform(line)).toBe('line');
  });

  it('refuses empty input', () => {
    expect(() => parseChat('hello there')).toThrow(/No messages/);
  });

  it('detects a multi-line LINE export with bracketed dates', () => {
    const bracket = [
      '[2024/03/12 21:04:11] Raka: okay so i finally tried that place',
      '[2024/03/12 21:05:02] Nadia: and????',
    ].join('\n');
    expect(detectPlatform(bracket)).toBe('line');
    const chat = parseChat(bracket, 'bracket.txt');
    expect(chat.platform).toBe('line');
    expect(chat.participants).toEqual(['Raka', 'Nadia']);
    expect(chat.messages[0]).toMatchObject({ date: '2024-03-12', time: '21:04:11', sender: 'Raka' });
  });

  it('appends continuation lines to the previous message', () => {
    const chat = parseChat(
      [
        '[12/03/24, 21:04:11] Nadia: first line',
        'second line',
        '[12/03/24, 21:04:40] Raka: ok',
      ].join('\n'),
    );
    expect(chat.messages[0].text).toBe('first line\nsecond line');
    expect(chat.messages).toHaveLength(2);
  });

  it('reads a two-digit year as this century', () => {
    const chat = parseChat('[12/03/24, 21:04:11] Nadia: hi\n[12/03/24, 21:04:40] Raka: hey');
    expect(chat.messages[0].date).toBe('2024-03-12');
  });

  it('reads day-first dates and swaps when the second number cannot be a month', () => {
    const dayFirst = parseChat('[25/03/24, 21:04:11] Nadia: hi\n[25/03/24, 21:04:40] Raka: hey');
    expect(dayFirst.messages[0].date).toBe('2024-03-25');
    const swapped = parseChat('[03/25/24, 21:04:11] Nadia: hi\n[03/25/24, 21:04:40] Raka: hey');
    expect(swapped.messages[0].date).toBe('2024-03-25');
  });

  it('reads AM and PM times into a twenty-four hour clock', () => {
    const chat = parseChat(
      '[12/03/24, 9:04:11 PM] Nadia: hi\n[13/03/24, 12:10:00 AM] Raka: hey\n[13/03/24, 9:05:00 AM] Nadia: morning',
    );
    expect(chat.messages.map(message => message.time)).toEqual(['21:04:11', '00:10:00', '09:05:00']);
  });

  it('marks a timestamped line with no sender as System and leaves it out of participants', () => {
    const chat = parseChat(
      '[12/03/24, 21:04:11] Messages and calls are end-to-end encrypted.\n[12/03/24, 21:04:40] Nadia: hi\n[12/03/24, 21:05:00] Raka: hey',
    );
    expect(chat.messages[0].sender).toBe('System');
    expect(chat.participants).toEqual(['Nadia', 'Raka']);
  });

  it('parses the LINE space layout', () => {
    const spaced = [
      '2024.03.12 21:04:11 Raka: okay so i finally tried that place',
      '2024.03.12 21:05:02 Nadia: and????',
    ].join('\n');
    expect(detectPlatform(spaced)).toBe('line');
    const chat = parseChat(spaced, 'space.txt');
    expect(chat.platform).toBe('line');
    expect(chat.messages[1]).toMatchObject({ sender: 'Nadia', text: 'and????' });
  });
});
