import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type PoolKind = 'replies' | 'strings';
export type SlotFormat = 'template' | 'raw' | 'tsPool';

export interface SlotDef {
  id: string;
  soul: string;
  tag: string;
  start: string;
  end: string;
  format: SlotFormat;
  pool?: PoolKind;
  includeStart?: boolean;
}

export interface FileDef {
  path: string;
  slots: SlotDef[];
}

export interface TargetDef {
  key: string;
  label: string;
  root: string;
  files: FileDef[];
}

export interface SlotFile {
  target: TargetDef;
  file: FileDef;
  source: string;
  slots: Array<SlotDef & { from: number; to: number }>;
}

/** The repo root. Next, vitest and the scripts all run from here. */
const projectRoot = resolve(process.cwd());

export function projectPath(...parts: string[]): string {
  return join(projectRoot, ...parts);
}

export function readAdapter(): { version: number; targets: Record<string, TargetDef> } {
  const raw = JSON.parse(readFileSync(projectPath('adapters', 'slots.json'), 'utf8')) as {
    version: number;
    targets: Record<string, Omit<TargetDef, 'key'>>;
  };
  const targets: Record<string, TargetDef> = {};
  for (const [key, value] of Object.entries(raw.targets)) targets[key] = { key, ...value };
  return { version: raw.version, targets };
}

export function baselinePath(target: TargetDef): string {
  const manifest = JSON.parse(readFileSync(projectPath('vendor', 'manifest.json'), 'utf8')) as Record<
    string,
    { path: string }
  >;
  const entry = manifest[target.root];
  if (!entry) throw new Error(`no vendor snapshot for ${target.root}; run npm run sync:baseline`);
  return projectPath(entry.path);
}

export function locateSlots(target: TargetDef, file: FileDef, source: string): SlotFile['slots'] {
  const found: SlotFile['slots'] = [];
  let cursor = 0;
  for (const slot of file.slots) {
    const startAt = source.indexOf(slot.start, cursor);
    if (startAt < 0) throw new Error(`${file.path}: start anchor not found for ${slot.id}`);
    const bodyFrom = slot.includeStart ? startAt : startAt + slot.start.length;
    const endAt = source.indexOf(slot.end, bodyFrom);
    if (endAt < 0) throw new Error(`${file.path}: end anchor not found for ${slot.id}`);
    found.push({ ...slot, from: bodyFrom, to: endAt });
    cursor = endAt;
  }
  return found;
}

export function readSlotFile(target: TargetDef, file: FileDef): SlotFile {
  const source = readFileSync(join(baselinePath(target), file.path), 'utf8');
  return { target, file, source, slots: locateSlots(target, file, source) };
}

export function extractSlots(slotFile: SlotFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of slotFile.slots) out[slot.id] = slotFile.source.slice(slot.from, slot.to);
  return out;
}

export function escapeTemplate(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

export function formatPool(value: unknown, kind: PoolKind): string {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${kind} pool must be a non-empty array`);
  if (kind === 'replies') {
    const rows = value.map(row => {
      if (!Array.isArray(row) || row.length === 0) throw new Error('a sample must be a non-empty array of bubbles');
      if (!row.every(item => typeof item === 'string' && item.trim().length > 0)) {
        throw new Error('every sample bubble must be a non-empty string');
      }
      return `  [${row.map(item => JSON.stringify(item)).join(', ')}],`;
    });
    return rows.join('\n');
  }
  if (!value.every(item => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error('every pool item must be a non-empty string');
  }
  return value.map(item => `  ${JSON.stringify(item)},`).join('\n');
}

export interface ApplyResult {
  path: string;
  source: string;
  bytes: number;
}

export function renderFile(
  slotFile: SlotFile,
  values: Record<string, unknown>,
  options: { raw?: boolean } = {},
): ApplyResult {
  const { source, slots } = slotFile;
  let out = '';
  let cursor = 0;
  for (const slot of slots) {
    const value = values[slot.id] ?? values[slot.soul];
    if (value === undefined) throw new Error(`missing soul slot ${slot.soul} for ${slot.id}`);
    let body: string;
    if (slot.format === 'tsPool') {
      body = options.raw ? String(value) : formatPool(value, slot.pool ?? 'strings');
    }
    else {
      if (typeof value !== 'string') throw new Error(`${slot.soul} must be text`);
      body = value.replace(/\r\n/g, '\n').replace(/\s+$/, '');
      if (!body) throw new Error(`${slot.soul} is empty`);
      if (slot.format === 'template') body = escapeTemplate(body);
    }
    out += source.slice(cursor, slot.from) + body;
    cursor = slot.to;
  }
  out += source.slice(cursor);
  return { path: slotFile.file.path, source: out, bytes: Buffer.byteLength(out) };
}

export function renderTarget(
  targetKey: string,
  values: Record<string, unknown>,
): ApplyResult[] {
  const adapter = readAdapter();
  const target = adapter.targets[targetKey];
  if (!target) throw new Error(`unknown target ${targetKey}`);
  return target.files.map(file => renderFile(readSlotFile(target, file), values));
}

export function soulSlotsFor(targetKey: string): string[] {
  const target = readAdapter().targets[targetKey];
  if (!target) throw new Error(`unknown target ${targetKey}`);
  return [...new Set(target.files.flatMap(file => file.slots.map(slot => slot.soul)))];
}
