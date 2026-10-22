export type Platform = 'whatsapp' | 'line' | 'unknown';

export type Relationship =
  | 'close friend'
  | 'partner'
  | 'family'
  | 'work'
  | 'group'
  | 'acquaintance';

export interface Message {
  id: number;
  date: string;
  time: string;
  timestamp: number;
  sender: string;
  text: string;
}

export interface RawChat {
  fileName: string;
  platform: Platform;
  participants: string[];
  messages: Message[];
}

export interface DateRange {
  start: string;
  end: string;
}

export interface ChatConfig {
  id: string;
  file: string;
  platform: Platform;
  participants: string[];
  subject: string;
  relationship: Relationship;
  range: DateRange;
}

export interface Chat extends ChatConfig {
  messages: Message[];
  stats: ChatStats;
}

export interface ChatStats {
  messages: number;
  subjectMessages: number;
  subjectShare: number;
  medianWords: number;
  p90Words: number;
  medianChars: number;
  p90Chars: number;
  bubblesPerTurn: number;
  p90Bubbles: number;
  questionRate: number;
  exclamationRate: number;
  emojiRate: number;
  laughRate: number;
  laughTokens: string[];
  doubleTextShare: number;
  initiations: number;
  conversations: number;
  endsConversations: number;
  medianReplySeconds: number;
  activeHours: number[];
  topEmoji: string[];
  capsRate: number;
  lowercaseStartRate: number;
  stretchedWords: string[];
  punctuationRuns: string[];
  languageMix: number;
  topSlang: string[];
  topNgrams: string[];
  mediaCount: number;
  stickerCount: number;
  voiceNoteCount: number;
}

export interface HeldOutPair {
  id: string;
  stimulus: string;
  reply: string[];
  date: string;
}

export interface EvidenceSlice {
  label: 'early' | 'middle' | 'late' | 'only';
  from: string;
  to: string;
}
