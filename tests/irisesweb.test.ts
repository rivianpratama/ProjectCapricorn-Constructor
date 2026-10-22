import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { templateExport, vocabularyLines, webSystemPrompt } from '../src/lib/fidelity/irisesweb';
import { baselinePath, readAdapter } from '../src/lib/soul/slots';

const wheel = readFileSync(
  join(baselinePath(readAdapter().targets['irises-web']), 'src/shared/wheel.ts'),
  'utf8',
);

/** Rebuild the vocabulary from the vendored data, so the hardcoded copy is checked, not trusted. */
function expectedVocabulary(): string {
  const block = (name: string) => wheel.match(new RegExp('export const ' + name + '[^=]*= \\{([\\s\\S]*?)\\n\\};'))![1];
  const strings = (text: string) => [...text.matchAll(/'([^']+)'/g)].map(match => match[1]);
  /** Entries are either `core: { secondary: [...], tertiary: [...] }` or `core: [...]`. */
  const lists = (body: string) => {
    const out: Record<string, string[]> = {};
    for (const match of body.matchAll(/(\w+):\s*(\{[^}]*\}|\[[^\]]*\])/g)) {
      out[match[1]] = strings(match[2]);
    }
    return out;
  };
  const cores = strings(wheel.match(/export const MOOD_CORES[^=]*= \[([^\]]*)\]/)![1]);
  const wheelWords = lists(block('WILLCOX_WHEEL'));
  const extended = lists(block('EXTENDED_WORDS'));
  return cores
    .map(core => `- ${core} covers ${[...(wheelWords[core] ?? []), ...(extended[core] ?? [])].join(', ')}`)
    .join('\n');
}

describe('IrisesWeb prompt reproduction', () => {
  it('matches the vendored mood vocabulary exactly', () => {
    expect(vocabularyLines()).toBe(expectedVocabulary());
  });

  it('reads a template export out of a module', () => {
    const persona = readFileSync(
      join(baselinePath(readAdapter().targets['irises-web']), 'src/worker/prompt/persona.ts'),
      'utf8',
    );
    expect(templateExport(persona, 'PERSONA').startsWith('## Who you are')).toBe(true);
  });

  it('joins the eight blocks in the same order as the snapshot', () => {
    const system = readFileSync(
      join(baselinePath(readAdapter().targets['irises-web']), 'src/worker/prompt/system.ts'),
      'utf8',
    );
    const order = system.match(/\[([A-Z_,\s]+)\]\.join/)![1].split(',').map(name => name.trim());
    expect(order).toEqual([
      'PERSONA',
      'HOW_YOU_WRITE',
      'DEMO_CONTEXT',
      'TOOL_DOC',
      'STATUS_CONTRACT',
      'SAFETY',
      'TURN_FRAME',
      'REPLY_FORMAT',
    ]);
    const prompt = webSystemPrompt({});
    for (const name of order.slice(2)) expect(prompt).toContain(templateExport(system, name).slice(0, 40));
    expect(prompt).toContain('- mad covers hurt, hostile, angry');
  });

  it('swaps in the pack persona and voice when a pack is given', () => {
    const persona = 'You are a child of two chats, and you keep it short.';
    const how = '## How you write\n\nOne thought per bubble.';
    const prompt = webSystemPrompt({
      'soul-pack/irises-web/src/worker/prompt/persona.ts': `export const PERSONA = \`${persona}\`;\nexport const HOW_YOU_WRITE = \`${how}\`;`,
    });
    expect(prompt.startsWith(persona)).toBe(true);
    expect(prompt).toContain(how);
    expect(prompt).not.toContain('a girl of twenty-one from Jakarta');
  });
});
