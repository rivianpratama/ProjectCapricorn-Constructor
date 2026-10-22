import { analyse, sliceRange } from '../chats/analyse';
import { parseChat } from '../chats/parse';
import type { ChatStats, Message, Platform, Relationship } from '../chats/types';

export type DraftStatus = 'idle' | 'running' | 'done' | 'error';

export interface Draft {
  id: string;
  fileName: string;
  platform: Platform;
  participants: string[];
  messages: Message[];
  subject: string;
  relationship: Relationship;
  from: number;
  to: number;
  status: DraftStatus;
  engram?: string;
  error?: string;
}

export const RELATIONSHIPS: Relationship[] = ['close friend', 'partner', 'family', 'work', 'group', 'acquaintance'];

let counter = 0;

export function draftFromFile(fileName: string, text: string): Draft {
  const chat = parseChat(text, fileName);
  const counts = new Map<string, number>();
  for (const message of chat.messages) counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1);
  const subject = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? chat.participants[0];
  return {
    id: `draft-${++counter}`,
    fileName,
    platform: chat.platform,
    participants: chat.participants,
    messages: chat.messages,
    subject,
    relationship: 'close friend',
    from: 0,
    to: chat.messages.length - 1,
    status: 'idle',
  };
}

export function draftMessages(draft: Draft): Message[] {
  return sliceRange(draft.messages, draft.messages[draft.from]?.date ?? '', draft.messages[draft.to]?.date ?? '');
}

export function draftStats(draft: Draft): ChatStats {
  return analyse(draftMessages(draft), draft.subject);
}

export function participantCount(draft: Draft, name: string): number {
  return draft.messages.filter(message => message.sender === name).length;
}

export function rangeDates(draft: Draft): { start: string; end: string } {
  return {
    start: draft.messages[draft.from]?.date ?? '',
    end: draft.messages[draft.to]?.date ?? '',
  };
}
