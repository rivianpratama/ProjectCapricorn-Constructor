export type MoodCore = 'mad' | 'scared' | 'joyful' | 'powerful' | 'peaceful' | 'sad';

export const MOOD_SHIFTS = ['lifted', 'steady', 'dipped', 'broke'] as const;
export type MoodShift = (typeof MOOD_SHIFTS)[number];

export const EPISTEMIC_TRIGGERS = ['none', 'knowledge_gap', 'logic_valid', 'emotional_pressure'] as const;
export type EpistemicTrigger = (typeof EPISTEMIC_TRIGGERS)[number];

export const INTENT_MODES = [
  'questioning', 'joking', 'agreeing', 'thanking', 'sharing_update', 'confused',
  'overwhelmed', 'venting', 'brainstorming', 'deflecting', 'asking_help', 'off_track',
] as const;
export type IntentMode = (typeof INTENT_MODES)[number];

export const TURN_SHAPES = ['task', 'idle', 'share', 'take'] as const;
export type TurnShape = (typeof TURN_SHAPES)[number];

export const HOOK_KINDS = ['judgment', 'callback', 'tangent', 'question'] as const;
export type HookKind = (typeof HOOK_KINDS)[number];

export const DELEGATE_KINDS = ['web_research', 'document_read', 'draft', 'general', 'media_read', 'compute'] as const;
export type DelegateKind = (typeof DELEGATE_KINDS)[number];

export type Effect = 'read' | 'act';

export interface Status {
  mood_label: string;
  mood_shift: MoodShift;
  intent_mode: IntentMode | null;
  turn: TurnShape | null;
  hook_kind: HookKind | null;
  epistemic_trigger: EpistemicTrigger;
  meta_prompt: string;
  turned_down: string | null;
}

export interface DelegateArgs {
  kind: DelegateKind;
  request: string;
  effect: Effect;
  meta_prompt: string;
  approved?: boolean;
}

export interface ToolCall { name: 'delegate_to_ops'; args: DelegateArgs }
export interface Bubble { text: string }

export interface Envelope {
  confidence_level: number;
  tool_calls: ToolCall[] | null;
  bubbles: Bubble[];
  status: Status | null;
}

export const GAUGE_KEYS = ['mood_level', 'anxiety', 'warmth', 'social_battery', 'patience', 'rapport'] as const;
export type GaugeKey = (typeof GAUGE_KEYS)[number];
export type Gauges = Record<GaugeKey, number>;

export interface AffectMove { at: number; k: GaugeKey; d: number; broke?: true }

export interface PendingAsk { request: string; kind: DelegateKind; brief: string; at: number }

export interface AffectState {
  v: 1;
  gauges: Gauges;
  /** '' on a cold start: no mood reported yet. */
  moodLabel: string;
  moodShift: MoodShift;
  intent: IntentMode | null;
  /** Her last meta_prompt (note to self). */
  note: string;
  /** Last three hook kinds, oldest first. */
  hookTrail: (HookKind | null)[];
  moves: AffectMove[];
  turns: number;
  pending: PendingAsk | null;
  /** Compose turns finished this session (0 means the next miss is the first). */
  delegations: number;
  at: number;
}

export type HistoryItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; bubbles: string[] };

export type FamiliarityBand = 'stranger' | 'acquaintance' | 'familiar' | 'close';

/** `approved`: the raw flag on her tool call (true only on a re-issue after their yes); shown in the agent window. */
export interface Delegation { request: string; kind: DelegateKind; brief: string; effect: Effect; approved?: boolean }

export type RefusalReason = 'session' | 'ip' | 'global' | 'burst';

export type CircadianSlot =
  | 'dead_night' | 'early_morning' | 'morning_sharp'
  | 'afternoon_dip' | 'afternoon_peak' | 'evening' | 'pre_sleep';

export interface ClockInfo {
  slot: CircadianSlot;
  hour: number;
  energy: number;
  cycleDay: number;
  cycleLoad: number;
  late: boolean;
  /** e.g. "Mon 5 Oct, 14:05" */
  label: string;
}

export interface TurnInfo {
  directives: string[];
  looseness: 1 | 2 | 3;
  bubbleCap: 1 | 2 | 3;
  clock: ClockInfo;
  familiarity: { score: number; band: FamiliarityBand };
  masked: boolean;
  quietForced: boolean;
  lastCredit: boolean;
  pending: boolean;
  safety: boolean;
}

/** Tokens, and what the call cost in USD (OpenRouter's own figure, else priced in shared/limits.ts). */
export interface Usage { prompt: number; cached: number; completion: number; usd: number }

export interface Meta {
  provider: 'deepseek' | 'openrouter' | 'mock' | 'floor';
  model: string;
  ms: number;
  usage: Usage;
  creditsLeft: number;
}

export interface StateEvent {
  state: AffectState;
  envelope: Envelope;
  ticket: string | null;
  parked: 'model' | 'lexicon' | null;
  delegation: Delegation | null;
}

export interface ChatRequest {
  history: HistoryItem[];
  state: unknown;
  text: string;
  tz: string;
  turn: number;
  /** how many bubbles she got out of the reply their message cut short (0: not cut) */
  cutOff: number;
}

export interface ComposeRequest {
  ticket: string;
  task: { request: string; kind: DelegateKind; brief: string; holding: string };
  history: HistoryItem[];
  state: unknown;
  tz: string;
}
