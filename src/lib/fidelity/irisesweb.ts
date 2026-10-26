import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselinePath, readAdapter } from '../soul/slots';
import { MEETING_CONTEXT } from './meeting';

/**
 * The vendored IrisesWeb prompt modules, read as text. The Try page must frame a turn exactly as
 * IrisesWeb does, so every block except persona and voice comes from the pinned snapshot.
 */
export interface WebPromptParts {
  persona: string;
  howYouWrite: string;
  systemTail: string[];
  voice: { samples: string[][]; stretch: string[]; punct: string[] };
}

const MODULES = [
  'src/worker/prompt/persona.ts',
  'src/worker/prompt/voice.ts',
  'src/worker/prompt/system.ts',
];

function read(target: string, file: string): string {
  const adapter = readAdapter();
  const def = adapter.targets[target];
  if (!def) throw new Error(`unknown target ${target}`);
  return readFileSync(join(baselinePath(def), file), 'utf8');
}

/** Pull `export const NAME = ` ... `;` out of a module. */
export function templateExport(source: string, name: string): string {
  const pattern = new RegExp('export const ' + name + ' = `([\\s\\S]*?)`;');
  const match = source.match(pattern);
  if (!match) throw new Error(`no export ${name}`);
  return match[1];
}

/**
 * Read a pool out of a prompt module. The snapshot writes these as TypeScript array literals with
 * single quotes, escaped quotes and `//` comments, so they are not JSON. This normalises them.
 */
export function poolExport(source: string, name: string): unknown {
  const pattern = new RegExp('export const ' + name + '(:[^=]+)? = \\[([\\s\\S]*?)\\n\\];');
  const match = source.match(pattern);
  if (!match) throw new Error(`no pool ${name}`);
  return JSON.parse(toJsonArray(match[2]));
}

/** One TypeScript array literal body, normalised to a JSON array. */
export function toJsonArray(body: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      if (char === '\\' && i + 1 < body.length) {
        const next = body[i + 1];
        if (next === quote) {
          out += next === "'" ? "'" : '\\"';
          i++;
          continue;
        }
        out += char + next;
        i++;
        continue;
      }
      if (char === quote) {
        out += '"';
        quote = null;
        continue;
      }
      out += char === '"' ? '\\"' : char;
      continue;
    }
    if (char === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += '"';
      continue;
    }
    out += char;
  }
  return `[${out}]`.replace(/,\s*(?=[\]}])/g, '');
}

/**
 * The eight blocks of IrisesWeb's SYSTEM_PROMPT, with the pack's persona and voice in place of the
 * snapshot's, and the demo context framed as a first meeting. Everything else is byte-identical.
 */
export function webSystemPrompt(pack: Record<string, string>): string {
  const system = read('irises-web', 'src/worker/prompt/system.ts');
  const persona = pack['soul-pack/irises-web/src/worker/prompt/persona.ts'];

  const personaText = persona ? templateExport(persona, 'PERSONA') : templateExport(read('irises-web', MODULES[0]), 'PERSONA');
  const howText = persona ? templateExport(persona, 'HOW_YOU_WRITE') : templateExport(read('irises-web', MODULES[0]), 'HOW_YOU_WRITE');

  // The demo page's context (a visitor test-driving Irises before installing it) becomes a first meeting.
  const blocks = ['DEMO_CONTEXT', 'TOOL_DOC', 'STATUS_CONTRACT', 'SAFETY', 'TURN_FRAME', 'REPLY_FORMAT'].map(name =>
    name === 'DEMO_CONTEXT' ? MEETING_CONTEXT : templateExport(system, name).replace('${vocabularyLines()}', vocabularyLines()),
  );
  return [personaText, howText, ...blocks].join('\n\n');
}

/** The mood vocabulary IrisesWeb splices into its status block. Pinned to the vendored snapshot. */
export function vocabularyLines(): string {
  const cores: Array<[string, string[]]> = [
    ['mad', ['hurt', 'hostile', 'angry', 'rage', 'hateful', 'critical', 'jealous', 'selfish', 'frustrated', 'furious', 'irritated', 'skeptical', 'snapped']],
    ['scared', ['rejected', 'confused', 'helpless', 'submissive', 'insecure', 'anxious', 'bewildered', 'discouraged', 'insignificant', 'weak', 'foolish', 'embarrassed', 'overwhelmed']],
    ['joyful', ['excited', 'sexy', 'energetic', 'playful', 'creative', 'aware', 'daring', 'fascinating', 'stimulating', 'amused', 'extravagant', 'delightful', 'cheerful', 'delighted', 'stimulated', 'curious', 'fascinated']],
    ['powerful', ['proud', 'respected', 'appreciated', 'important', 'faithful', 'hopeful', 'cheerful', 'satisfied', 'valuable', 'worthwhile', 'intelligent', 'confident']],
    ['peaceful', ['content', 'thoughtful', 'intimate', 'loving', 'trusting', 'nurturing', 'thankful', 'sentimental', 'serene', 'responsive', 'relaxed', 'pensive', 'tender']],
    ['sad', ['guilty', 'ashamed', 'depressed', 'lonely', 'bored', 'sleepy', 'apathetic', 'inferior', 'inadequate', 'miserable', 'stupid', 'bashful', 'drained', 'withdrawn', 'tired']],
  ];
  return cores.map(([core, words]) => `- ${core} covers ${words.join(', ')}`).join('\n');
}
