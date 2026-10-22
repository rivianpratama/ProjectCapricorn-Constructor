import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'prompts');

export function prompt(name: 'phase1' | 'phase1-merge' | 'phase2' | 'phase3a' | 'phase3m' | 'phase3b'): string {
  return readFileSync(join(dir, `${name}.md`), 'utf8').trim();
}
