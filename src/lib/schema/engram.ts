import { z } from 'zod';
import { numberedIndex, splitSections, type Section } from './markdown';

export const FREQUENCIES = ['once', 'sometimes', 'often', 'almost always'] as const;
export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export const ENGRAIN_SECTIONS = [
  'Context',
  'Surface (L3)',
  'Moves (L2)',
  'Emotion',
  'Core (L1) hypotheses',
  'Stances and tastes',
  'Shadow',
  'Drift',
  'Context-specific (the overfit fence)',
  'Exemplars',
  'Gaps',
] as const;

export const FindingSchema = z.object({
  id: z.string().min(1),
  quotes: z.array(z.string().min(1)).min(1).max(3),
  frequency: z.enum(FREQUENCIES),
  scope: z.string().min(1),
  confidence: z.enum(CONFIDENCES),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ExemplarSchema = z.object({
  stimulus: z.string().min(1),
  reply: z.array(z.string().min(1)).min(1),
  move: z.string().min(1),
  mood: z.string().min(1),
  specificity: z.enum(['generic', 'specific']),
});
export type Exemplar = z.infer<typeof ExemplarSchema>;

export const EngramSchema = z.object({
  chat: z.string().min(1),
  sections: z.record(z.string(), z.string()),
  findings: z.array(FindingSchema),
  exemplars: z.array(ExemplarSchema),
  moves: z.array(z.string().min(1)),
});
export type Engram = z.infer<typeof EngramSchema>;

/** One line the model wrote as a finding but the parser could not keep, with the reason. */
export interface FindingReject {
  line: string;
  reason: string;
}

/** How a model usually fails the finding contract, said so the retry can name it. */
export interface FindingSummary {
  kept: number;
  rejected: FindingReject[];
  /** Findings the model said were not observed, each with the searches it ran. */
  receipts: string[];
}

export function parseEngram(markdown: string, chat = 'chat'): Engram {
  return parseEngramDetailed(markdown, chat).engram;
}

/** `parseEngram`, plus why any finding line was dropped: a silent drop is what "no findings" reports. */
export function parseEngramDetailed(markdown: string, chat = 'chat'): { engram: Engram; findings: FindingSummary } {
  const document = splitSections(markdown);
  assertHeadings(document.sections);
  const sections: Record<string, string> = {};
  for (const section of document.sections) {
    const key = `${numberedIndex(section.title)}. ${stripNumber(section.title)}`;
    sections[key] = section.body;
    sections[section.title] = section.body;
  }

  const findings: Finding[] = [];
  const rejected: FindingReject[] = [];
  for (const match of markdown.matchAll(/^[ \t]*-?[ \t]*`?id`?[ \t]*[:=][ \t]*`?([\w.-]+)`?.*$/gim)) {
    const { finding, reason } = parseFindingLine(match[0]);
    if (finding) findings.push(finding);
    else if (reason) rejected.push({ line: match[0].trim().slice(0, 160), reason });
  }
  const receipts = [...markdown.matchAll(/\(?searched:\s*([^)\n]+)\)?/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);

  const exemplars = parseExemplars(sections['10. Exemplars'] ?? '');
  const moves = [...new Set(exemplars.map(exemplar => exemplar.move))];

  const engram = EngramSchema.parse({ chat, sections, findings, exemplars, moves });
  return { engram, findings: { kept: findings.length, rejected, receipts } };
}

function assertHeadings(sections: Section[]): void {
  const expected = ENGRAIN_SECTIONS.map((name, i) => `${i + 1}. ${name}`);
  const actual = sections.map(section => `${numberedIndex(section.title)}. ${stripNumber(section.title)}`);
  if (actual.length !== expected.length) {
    throw new Error(`engram needs ${expected.length} sections, found ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`engram section ${i + 1} should be "${expected[i]}", found "${actual[i]}"`);
    }
  }
}

function stripNumber(title: string): string {
  return title
    .replace(/^[*_#`\s]+/, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/[*_#:`\s]+$/, '')
    .trim();
}

const FIELD = /`?(id|frequency|scope|confidence)`?\s*[:=]\s*`?([^`\n,;]+)`?/gi;

/**
 * One finding line, or the reason it cannot be a finding. A line without any finding labels
 * such as `- id: exact quote` is prose that happens to start with "id", and says nothing.
 */
function parseFindingLine(line: string): { finding: Finding | null; reason: string } {
  const fields: Record<string, string> = {};
  for (const match of line.matchAll(FIELD)) fields[match[1].toLowerCase()] = match[2].trim();
  const quotesMatch = line.match(/quotes?\s*[:=]\s*([^\n]+?)(?:,\s*(?:msgs|count|frequency|scope|confidence)|$)/i);
  const quotesSection = quotesMatch ? quotesMatch[1] : line;
  const quotes = [
    ...quotesSection.matchAll(/["“]([^"”\n]{2,})["”]|['‘]([^'’\n]{2,})['’]|`([^`\n]{2,})`/g),
  ]
    .map(match => (match[1] ?? match[2] ?? match[3]).trim())
    .filter(Boolean);
  const frequency = normalise(fields.frequency, FREQUENCIES);
  const confidence = normalise(fields.confidence, CONFIDENCES);
  const labelled = Boolean(
    fields.frequency || fields.scope || fields.confidence || /quotes?\s*[:=]/i.test(line),
  );
  if (!labelled) return { finding: null, reason: '' };
  const missing = [
    fields.scope ? '' : 'scope',
    frequency ? '' : `frequency${fields.frequency ? ` "${fields.frequency}"` : ''}`,
    confidence ? '' : `confidence${fields.confidence ? ` "${fields.confidence}"` : ''}`,
  ].filter(Boolean);
  if (!fields.id || missing.length) {
    return { finding: null, reason: `finding has no usable ${missing.length ? missing.join(', ') : 'id'}` };
  }
  // `quotes:` with nothing after it is a quote that failed check, not a malformed line.
  if (!quotes.length) return { finding: null, reason: '' };
  return {
    finding: FindingSchema.parse({
      id: fields.id,
      quotes: quotes.slice(0, 3),
      frequency,
      scope: fields.scope!,
      confidence,
    }),
    reason: '',
  };
}

function normalise<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  return (allowed.find(item => item === lower) ?? null) as T | null;
}

const EXEMPLAR_HEAD = /^\[(.+?)\]\s*->\s*\[(.+?)\]\s*$/;
const EXEMPLAR_TAGS = /^move:\s*([^|]+?)\s*\|\s*mood:\s*([^|]+?)\s*\|\s*(generic|specific)\s*$/i;
/** The same exchange with a speaker label, brackets or not: `Bima: and???? -> it was so good`. */
const EXEMPLAR_LABELLED = /^[^:\[\n]{1,30}:\s*\[(.+?)\]\s*->\s*\[(.+?)\]\s*$/;
/**
 * Last resort, for a model that dropped the brackets too. A bare arrow line only counts right
 * above a tags line, which keeps prose like "the plan -> the rent" from becoming an exemplar.
 */
const EXEMPLAR_ARROW = /^(?:[^:\n]{1,30}:\s*)?(.+?)\s+->\s+(.+?)\s*$/;

/** A speaker label on the head line is the same two-line exchange, and models add one often. */
function parseExemplars(block: string): Exemplar[] {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  const out: Exemplar[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tags = lines[i + 1]?.match(EXEMPLAR_TAGS);
    if (!tags) continue;
    const head =
      lines[i].match(EXEMPLAR_HEAD) ?? lines[i].match(EXEMPLAR_LABELLED) ?? lines[i].match(EXEMPLAR_ARROW);
    if (!head) continue;
    out.push(
      ExemplarSchema.parse({
        stimulus: head[1].trim(),
        reply: head[2].split(' / ').map(bubble => bubble.trim()).filter(Boolean),
        move: tags[1].trim().toLowerCase(),
        mood: tags[2].trim().toLowerCase(),
        specificity: tags[3].toLowerCase(),
      }),
    );
    i++;
  }
  return out;
}
