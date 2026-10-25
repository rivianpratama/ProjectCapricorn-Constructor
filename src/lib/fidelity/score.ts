import { ngramIndex, openerDistinctness, overlapShare } from '../chats/analyse';

export interface LikenessPair {
  stimulus: string;
  real: string[];
  generated: string[];
}

export interface LikenessJudgement {
  /** True when the judge picked the real reply. */
  pickedReal: boolean;
  /** 1 to 5 for voice, move choice and emotional fit. */
  voice: number;
  move: number;
  emotion: number;
  /** Set when the pair leaned on a trait the owner removed, so the pair is not counted. */
  skipped?: boolean;
}

export interface LikenessResult {
  /** How often the judge picked the real person. Near half is the target: the child is not telling. */
  realPicked: number;
  total: number;
  voice: number;
  move: number;
  emotion: number;
  skipped: number;
}

export interface GeneralisationResult {
  score: number;
  judged: number;
  missed: string[];
}

export interface ParrotingResult {
  /** Share of the child's four-grams that already appear in the subject's own messages. */
  overlap: number;
  /** Share of twenty replies with a distinct opener. */
  openerDistinctness: number;
  openers: string[];
}

export const THRESHOLDS = {
  /** Above this, the child is copying the parents rather than being their child. */
  maxOverlap: 0.35,
  /** Below this, the child has one opening move and nothing else. */
  minOpenerDistinctness: 0.6,
  /** Below this, the child cannot act in a situation it has not seen. */
  minGeneralisation: 3.5,
} as const;

export function scoreLikeness(pairs: LikenessPair[], judgements: Array<LikenessJudgement | null>): LikenessResult {
  const judged = pairs
    .map((_, i) => judgements[i])
    .filter((judgement): judgement is LikenessJudgement => judgement !== null && judgement !== undefined && !judgement.skipped);
  return {
    realPicked: judged.filter(judgement => judgement.pickedReal).length,
    total: judged.length,
    voice: mean(judged.map(judgement => judgement.voice)),
    move: mean(judged.map(judgement => judgement.move)),
    emotion: mean(judged.map(judgement => judgement.emotion)),
    skipped: pairs.length - judged.length,
  };
}

export function scoreParroting(generated: string[][], subjectMessages: string[]): ParrotingResult {
  const index = ngramIndex(subjectMessages);
  const flat = generated.map(bubbles => bubbles.join(' '));
  const overlaps = flat.map(text => overlapShare(text, index));
  return {
    overlap: mean(overlaps),
    openerDistinctness: openerDistinctness(generated),
    openers: generated.map(bubbles => (bubbles[0] ?? '').trim().toLowerCase()).filter(Boolean),
  };
}

export interface Verdict {
  likeness: boolean;
  generalisation: boolean;
  parroting: boolean;
  revise: Array<'generalisation' | 'parroting'>;
}

export function verdict(input: { generalisation: GeneralisationResult; parroting: ParrotingResult }): Verdict {
  const generalisation = input.generalisation.score >= THRESHOLDS.minGeneralisation;
  const parroting =
    input.parroting.overlap <= THRESHOLDS.maxOverlap &&
    input.parroting.openerDistinctness >= THRESHOLDS.minOpenerDistinctness;
  const revise: Verdict['revise'] = [];
  if (!generalisation) revise.push('generalisation');
  if (!parroting) revise.push('parroting');
  return { likeness: true, generalisation, parroting, revise };
}

/** Deterministic coin for the blind A/B, so the same pair is not always shown the same way round. */
export function realIsFirst(seed: number): boolean {
  return Math.abs(Math.floor(seed)) % 2 === 0;
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}
