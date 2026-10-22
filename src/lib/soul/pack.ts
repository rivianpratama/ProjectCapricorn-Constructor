import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderTarget, projectPath, type ApplyResult } from './slots';
import { lintPools, lintSoul, lintWebLength, type LintIssue } from './lint';
import { SOUL_SLOTS, type Soul } from './parseSoul';
import { renderApply } from './apply';

export interface PackFile {
  path: string;
  source: string;
  bytes: number;
}

export interface PackOptions {
  /** How many chats this child was built from. */
  n?: number;
  /** The vendored SHAs the pack was rendered against, for APPLY.md. */
  targetShas?: Record<string, string>;
  /** The merged report, shipped beside the soul. */
  report?: string;
}

export interface Pack {
  files: PackFile[];
  issues: LintIssue[];
  poolIssues: ReturnType<typeof lintPools>;
}

const PACK_ROOT = 'soul-pack';
const TARGETS = ['irises', 'irises-web'] as const;

/** Turn one SOUL into every file of the pack, in memory. `soulMarkdown` is kept verbatim as SOUL.md. */
export function buildPack(soul: Soul, soulMarkdown: string, options: PackOptions = {}): Pack {
  const values: Record<string, unknown> = {
    'iris.persona': soul['iris.persona'],
    'iris.how': soul['iris.how'],
    'iris.language': soul['iris.language'],
    'iris.banter': soul['iris.banter'],
    'web.persona': soul['web.persona'],
    'web.how': soul['web.how'],
    samples: soul.pools.samples,
    stretch: soul.pools.stretch,
    punct: soul.pools.punct,
  };

  const files: PackFile[] = [];
  for (const target of TARGETS) {
    for (const rendered of renderTarget(target, values)) {
      files.push(toPackFile(target, rendered));
    }
  }

  files.push({
    path: `${PACK_ROOT}/SOUL.md`,
    source: soulMarkdown,
    bytes: Buffer.byteLength(soulMarkdown),
  });
  if (options.report) {
    files.push({
      path: `${PACK_ROOT}/ENGRAM_REPORT.md`,
      source: options.report,
      bytes: Buffer.byteLength(options.report),
    });
  }

  const issues = [
    ...lintSoul(Object.fromEntries(SOUL_SLOTS.map(slot => [slot, soul[slot]]))),
    ...lintWebLength(Object.fromEntries(SOUL_SLOTS.map(slot => [slot, soul[slot]])), 12_000),
  ];
  const poolIssues = lintPools(soul.pools);
  const apply = renderApply({
    pack: { files, issues, poolIssues },
    changelog: soul.changelog,
    n: options.n ?? 1,
    targetShas: options.targetShas ?? manifestShas(),
  });
  files.push({ path: `${PACK_ROOT}/APPLY.md`, source: apply, bytes: Buffer.byteLength(apply) });

  return { files, issues, poolIssues };
}

function manifestShas(): Record<string, string> {
  try {
    const manifest = JSON.parse(readFileSync(projectPath('vendor', 'manifest.json'), 'utf8')) as Record<string, { sha: string }>;
    return Object.fromEntries(Object.entries(manifest).map(([key, value]) => [key, value.sha]));
  } catch {
    return {};
  }
}

function toPackFile(target: string, rendered: ApplyResult): PackFile {
  return {
    path: `${PACK_ROOT}/${target}/${rendered.path}`,
    source: rendered.source,
    bytes: rendered.bytes,
  };
}

export function writePack(pack: Pack): string[] {
  const written: string[] = [];
  for (const file of pack.files) {
    const target = join(projectPath(PACK_ROOT), file.path.slice(PACK_ROOT.length + 1));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.source, 'utf8');
    written.push(file.path);
  }
  return written;
}
