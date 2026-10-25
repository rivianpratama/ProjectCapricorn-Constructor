import { z } from 'zod';
import { splitSections, numberedIndex } from './markdown';
import { labelledFields } from './fields';
import { CONFIDENCES, ExemplarSchema } from './engram';

export const REPORT_SECTIONS = [
  'Trait ledger',
  'Inheritance',
  'Contradictions',
  'Red thread',
  'Warm-up arc',
  'Surface',
  'Light and shadow',
  'Novel situations',
  'Exemplar pool',
  'Life facts',
  'Questionnaire candidates',
] as const;

export const LedgerRowSchema = z.object({
  id: z.string().min(1),
  trait: z.string().min(1),
  supporting: z.array(z.string().min(1)).min(1),
  contradicting: z.array(z.string()),
  confidence: z.enum(CONFIDENCES),
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export const DriveSchema = z.object({
  id: z.string().min(1),
  drive: z.string().min(1),
  sources: z.array(z.string().min(1)).min(2),
});
export type Drive = z.infer<typeof DriveSchema>;

export const SketchSchema = z.object({
  index: z.number().int().min(1).max(8),
  situation: z.string().min(1),
  drive: z.string().min(1),
});
export type Sketch = z.infer<typeof SketchSchema>;

export const ReportSchema = z.object({
  sections: z.record(z.string(), z.string()),
  ledger: z.array(LedgerRowSchema),
  drives: z.array(DriveSchema).min(3).max(6),
  sketches: z.array(SketchSchema).length(8),
  pool: z.array(ExemplarSchema),
  warmUp: z.array(z.string().min(1)).length(3),
});
export type Report = z.infer<typeof ReportSchema>;

/**
 * Sections that carry decisions for later phases, so an empty body is never acceptable: the
 * fetcher builds memories from Life facts, the questionnaire filters sensitive ones with
 * Questionnaire candidates, and the soul reads Light and shadow. A heading with nothing under
 * it would let all three proceed on nothing.
 */
const NEVER_EMPTY = [
  '2. Inheritance',
  '3. Contradictions',
  '7. Light and shadow',
  '10. Life facts',
  '11. Questionnaire candidates',
];

export function parseReport(markdown: string): Report {
  const document = splitSections(markdown);
  assertHeadings(document.sections);
  const sections: Record<string, string> = {};
  for (const section of document.sections) {
    const key = `${numberedIndex(section.title)}. ${stripNumber(section.title)}`;
    sections[key] = section.body;
    sections[section.title] = section.body;
  }
  const empty = NEVER_EMPTY.filter(name => !(sections[name] ?? '').trim());
  if (empty.length) {
    const list = empty.map(name => `"## ${name}"`).join(', ');
    throw new Error(`report section${empty.length > 1 ? 's' : ''} ${list} ${empty.length > 1 ? 'are' : 'is'} empty; write the content under the heading`);
  }

  try {
    return ReportSchema.parse({
      sections,
      ledger: parseLedger(sections['1. Trait ledger'] ?? ''),
      drives: parseDrives(sections['4. Red thread'] ?? ''),
      sketches: parseSketches(sections['8. Novel situations'] ?? ''),
      pool: parsePool(sections['9. Exemplar pool'] ?? ''),
      warmUp: parseWarmUp(sections['5. Warm-up arc'] ?? ''),
    });
  } catch (error) {
    throw readable(error);
  }
}

/** A parse failure as one sentence a model can be told about and a person can act on. */
function readable(error: unknown): Error {
  if (error instanceof Error && 'issues' in error && Array.isArray(error.issues)) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    const lines = issues.slice(0, 6).map(issue => `${issue.path.join('.') || 'report'}: ${issue.message}`);
    return new Error(`report has ${issues.length} problem${issues.length === 1 ? '' : 's'}: ${lines.join('; ')}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function assertHeadings(sections: ReturnType<typeof splitSections>['sections']): void {
  const expected = REPORT_SECTIONS.map((name, i) => `${i + 1}. ${name}`);
  const actual = sections.map(section => `${numberedIndex(section.title)}. ${stripNumber(section.title)}`);
  if (actual.length !== expected.length) {
    const found = actual.length ? actual.join(', ') : 'no numbered headings';
    throw new Error(`report needs ${expected.length} sections, found ${actual.length} (${found})`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (normalise(actual[i]) !== normalise(expected[i])) {
      throw new Error(`report section ${i + 1} should be "${expected[i]}", found "${actual[i]}"`);
    }
  }
}

/** Headings match on the section's name, not on how the model cased, spaced or punctuated it. */
function normalise(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s*\.\s*/g, '. ')
    .trim();
}

function stripNumber(title: string): string {
  return title
    .replace(/^[*_#`\s]+/, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/[*_#:`\s]+$/, '')
    .trim();
}

function parseLedger(block: string): LedgerRow[] {
  return block
    .split('\n')
    .map(line => line.trim())
    // The bullet is the prompt's habit, not a requirement: a row is a row wherever it starts with `id:`.
    .filter(line => /^[-*+]?\s*`?id`?\s*[:=]/i.test(line))
    .map(line => {
      const fields = labelledFields(line, ['id', 'trait', 'layer', 'supporting', 'contradicting', 'class', 'confidence']);
      const id = clean(fields.id);
      const trait = clean(fields.trait);
      const confidence = clean(fields.confidence).toLowerCase();
      if (!id || !trait || !confidence) throw new Error(`trait ledger row is missing id, trait or confidence: ${line}`);
      const supporting = citedSources(fields.supporting ?? '');
      if (supporting.length === 0) throw new Error(`trait ledger row cites no supporting source: ${id}`);
      return LedgerRowSchema.parse({
        id,
        trait,
        supporting,
        contradicting: citedSources(fields.contradicting ?? ''),
        confidence,
      });
    });
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/[`"]/g, '').replace(/[,\s]+$/, '').trim();
}

function citedSources(value: string): string[] {
  return [...value.matchAll(/\bchat-\d+(?:\s+(?:early|middle|late))?\b/gi)].map(match =>
    match[0].replace(/\s+/g, ' ').trim(),
  );
}

function parseDrives(block: string): Drive[] {
  const rows = block
    .split(/\n(?=[-*+]?\s*`?id`?\s*[:=])/i)
    .map(chunk => chunk.trim())
    .filter(chunk => /^[-*+]?\s*`?id`?\s*[:=]/i.test(chunk));
  return rows.map(row => {
    const line = row.split('\n')[0].replace(/\s+/g, ' ');
    const fields = labelledFields(line, ['id', 'drive', 'sources']);
    const id = clean(fields.id);
    const drive = clean(fields.drive);
    const sources = citedSources(fields.sources ?? '');
    if (!id || !drive) throw new Error(`red thread entry is missing id or drive: ${line}`);
    if (sources.length < 2) throw new Error(`red thread drive "${id}" cites ${sources.length} source(s), needs at least two`);
    return DriveSchema.parse({ id, drive, sources });
  });
}

function parseSketches(block: string): Sketch[] {
  const chunks = block.split(/\n(?=\d+[.)]\s)/).map(chunk => chunk.trim()).filter(Boolean);
  if (chunks.length !== 8) throw new Error(`novel situations need eight entries, found ${chunks.length}`);
  return chunks.map((chunk, i) => {
    const first = chunk.split('\n')[0];
    const index = Number(first.match(/^(\d+)[.)]/)?.[1] ?? i + 1);
    const situation = first.replace(/^\d+[.)]\s*/, '').trim();
    const drive = clean(chunk.match(/`?drive`?\s*[:=]\s*(.+)/i)?.[1]);
    if (!situation) throw new Error(`novel situation ${index} has no text`);
    if (!drive) throw new Error(`novel situation ${index} names no drive`);
    return SketchSchema.parse({ index, situation, drive });
  });
}

function parsePool(block: string): z.infer<typeof ExemplarSchema>[] {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  const out: z.infer<typeof ExemplarSchema>[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^\[(.+?)\]\s*->\s*\[(.+?)\]\s*$/);
    if (!head) continue;
    const tags = lines[i + 1]?.match(/^move:\s*([^|]+?)\s*\|\s*mood:\s*([^|]+?)\s*\|\s*(generic|specific)\s*$/i);
    if (!tags) continue;
    out.push(ExemplarSchema.parse({
      stimulus: head[1].trim(),
      reply: head[2].split(' / ').map(bubble => bubble.trim()).filter(Boolean),
      move: tags[1].trim().toLowerCase(),
      mood: tags[2].trim().toLowerCase(),
      specificity: tags[3].toLowerCase(),
    }));
    i++;
  }
  return out;
}

/**
 * The three stages, under labels the model may write as `**stranger**`, `**Stranger:**`,
 * `- **stranger**` or `### Stranger`. A stage runs to the next stage's label or the next
 * heading of any kind (bold, hash or a numbered list item); anything else is its body.
 */
function parseWarmUp(block: string): string[] {
  const stages = ['stranger', 'familiar', 'close'];
  const label = (stage: string): RegExp =>
    new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?(?:#{1,6}[ \\t]+)?(?:\\*{1,2}[ \\t]*)?${stage}\\b[ \\t]*(?:\\*{1,2})?[ \\t]*:?[ \\t]*(.*)$`, 'i');
  const boundary = /^[ \t]*(?:#{1,6}[ \t]+|\*{1,2}[^\n]+?\*{1,2}:?[ \t]*$|(?:[-*+][ \t]+)?\d+[.)][ \t]+\S)/;
  const lines = block.split('\n');
  const found = stages.map(() => '');
  for (const [i, line] of lines.entries()) {
    const index = stages.findIndex(stage => label(stage).test(line));
    if (index < 0) continue;
    const rest = (label(stages[index]).exec(line)?.[1] ?? '').replace(/^[*_\s]+/, '');
    const body: string[] = rest.trim() ? [rest] : [];
    for (const next of lines.slice(i + 1)) {
      if (stages.some(stage => label(stage).test(next)) || boundary.test(next)) break;
      body.push(next);
    }
    found[index] = body.join(' ').replace(/\s+/g, ' ').trim();
  }
  return found;
}
