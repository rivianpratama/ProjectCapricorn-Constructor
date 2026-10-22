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

export function parseReport(markdown: string): Report {
  const document = splitSections(markdown);
  assertHeadings(document.sections);
  const sections: Record<string, string> = {};
  for (const section of document.sections) sections[section.title] = section.body;

  return ReportSchema.parse({
    sections,
    ledger: parseLedger(sections['1. Trait ledger'] ?? ''),
    drives: parseDrives(sections['4. Red thread'] ?? ''),
    sketches: parseSketches(sections['8. Novel situations'] ?? ''),
    pool: parsePool(sections['9. Exemplar pool'] ?? ''),
    warmUp: parseWarmUp(sections['5. Warm-up arc'] ?? ''),
  });
}

function assertHeadings(sections: ReturnType<typeof splitSections>['sections']): void {
  const expected = REPORT_SECTIONS.map((name, i) => `${i + 1}. ${name}`);
  const actual = sections.map(section => `${numberedIndex(section.title)}. ${section.title.replace(/^\d+\.\s*/, '').trim()}`);
  if (actual.length !== expected.length) {
    throw new Error(`report needs ${expected.length} sections, found ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`report section ${i + 1} should be "${expected[i]}", found "${actual[i]}"`);
    }
  }
}

function parseLedger(block: string): LedgerRow[] {
  return block
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*]\s+`?id`?\s*[:=]/i.test(line))
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
    .split(/\n(?=[-*]\s)/)
    .map(chunk => chunk.trim())
    .filter(chunk => /^[-*]\s+`?id`?\s*[:=]/i.test(chunk));
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

function parseWarmUp(block: string): string[] {
  const stages = ['stranger', 'familiar', 'close'];
  const found = stages.map(stage => {
    const match = block.match(new RegExp(`\\*\\*${stage}\\*\\*\\s*[:\\-]?\\s*([\\s\\S]*?)(?=\\n\\*\\*|$)`, 'i'));
    return match ? match[1].replace(/\s+/g, ' ').trim() : '';
  });
  return found;
}
