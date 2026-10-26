import { extractSlots, readAdapter, readSlotFile } from './slots';

/** Iris's current slot text, keyed by soul slot, read read-only from the vendored targets. */
export function baseSlots(): Record<string, string> {
  const adapter = readAdapter();
  const out: Record<string, string> = {};
  for (const key of ['irises', 'irises-web'] as const) {
    const target = adapter.targets[key];
    if (!target) continue;
    for (const file of target.files) {
      const extracted = extractSlots(readSlotFile(target, file));
      for (const slot of file.slots) {
        if (out[slot.soul] === undefined && extracted[slot.id] !== undefined) out[slot.soul] = extracted[slot.id];
      }
    }
  }
  return out;
}
