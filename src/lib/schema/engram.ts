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

export function parseEngram(markdown: string, chat = 'chat'): Engram {
  const document = splitSections(markdown);
  assertHeadings(document.sections);
  const sections: Record<string, string> = {};
  for (const section of document.sections) sections[section.title] = section.body;

  const findings = [...markdown.matchAll(/^[ \t]*-?[ \t]*`?id`?[ \t]*[:=][ \t]*`?([\w.-]+)`?.*$/gim)].flatMap(
    match => {
      const line = match[0];
      const parsed = parseFindingLine(line);
      return parsed ? [parsed] : [];
    },
  );

  const exemplars = parseExemplars(sections['10. Exemplars'] ?? '');
  const moves = [...new Set(exemplars.map(exemplar => exemplar.move))];

  return EngramSchema.parse({ chat, sections, findings, exemplars, moves });
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
  return title.replace(/^\d+\.\s*/, '').trim();
}

const FIELD = /`?(id|frequency|scope|confidence)`?\s*[:=]\s*`?([^`\n,;]+)`?/gi;

function parseFindingLine(line: string): Finding | null {
  const fields: Record<string, string> = {};
  for (const match of line.matchAll(FIELD)) fields[match[1].toLowerCase()] = match[2].trim();
  const quotes = [...line.matchAll(/[""]([^""]{2,})[""]|"([^"]{2,})"/g)].map(
    match => (match[1] ?? match[2]).trim(),
  );
  const frequency = normalise(fields.frequency, FREQUENCIES);
  const confidence = normalise(fields.confidence, CONFIDENCES);
  if (!fields.id || !fields.scope || !frequency || !confidence || quotes.length === 0) return null;
  return FindingSchema.parse({
    id: fields.id,
    quotes: quotes.slice(0, 3),
    frequency,
    scope: fields.scope,
    confidence,
  });
}

function normalise<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  return (allowed.find(item => item === lower) ?? null) as T | null;
}

const EXEMPLAR_HEAD = /^\[(.+?)\]\s*->\s*\[(.+?)\]\s*$/;
const EXEMPLAR_TAGS = /^move:\s*([^|]+?)\s*\|\s*mood:\s*([^|]+?)\s*\|\s*(generic|specific)\s*$/i;

export function parseExemplars(block: string): Exemplar[] {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  const out: Exemplar[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(EXEMPLAR_HEAD);
    if (!head) continue;
    const tags = lines[i + 1]?.match(EXEMPLAR_TAGS);
    if (!tags) continue;
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
