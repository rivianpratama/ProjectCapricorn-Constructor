import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselinePath, readAdapter } from '../soul/slots';
import {
  PUNCT_COUNT,
  SAMPLE_COUNT,
  STRETCH_COUNT,
  buildTail as vendorBuildTail,
  jsonAnchor,
  lastStep,
  pick,
  stripTags,
  voiceSamplesFor as vendorVoiceSamples,
  type PendingAsk,
  type TailInput as VendorTailInput,
} from '../../../vendor/irises-web/current';
import { poolExport } from './irisesweb';
import { asMeeting } from './meeting';

/**
 * The turn tail is IrisesWeb's own `buildTail`, imported from the pinned snapshot, not a copy of
 * it. The snapshot reads its voice pools from `prompt/voice.ts`; the one thing it cannot take from
 * an import is the pack's pools, so this wraps it and swaps the three picked strings. Every block,
 * fence, drift law and anchor still comes from the snapshot.
 */
export { jsonAnchor, pick, stripTags };
export type { PendingAsk, VendorTailInput };

const VOICE_PACK = 'soul-pack/irises-web/src/worker/prompt/voice.ts';

/** The snapshot's input, minus the three demo-page fields TryRoom does not run. */
export type TryTailInput = Omit<VendorTailInput, 'pending' | 'lastCredit' | 'cutOff'> & {
  pending?: PendingAsk | null;
  lastCredit?: boolean;
  cutOff?: number;
};

export function toVendorTail(input: TryTailInput): VendorTailInput {
  return { ...input, pending: input.pending ?? null, lastCredit: input.lastCredit ?? false, cutOff: input.cutOff ?? 0 };
}

interface Pools {
  samples: string[][];
  stretch: string[];
  punct: string[];
}

/** The pack's pools, or null when it carries no voice file (then the snapshot's own pools run). */
function packPools(pack: Record<string, string>): Pools | null {
  const source = pack[VOICE_PACK];
  if (!source) return null;
  return {
    samples: poolExport(source, 'SAMPLE_REPLIES') as string[][],
    stretch: poolExport(source, 'STRETCH_WORDS') as string[],
    punct: poolExport(source, 'PUNCT_RUNS') as string[],
  };
}

/** The same three picks `voiceSamplesFor` makes, over the pack's pools: counts and seeds are its own. */
function packedSamples(pools: Pools, seed: number): { samples: string; stretch: string; punct: string } {
  return {
    samples: pick(pools.samples, SAMPLE_COUNT, seed).map(row => JSON.stringify(row)).join(' \u00b7 '),
    stretch: pick(pools.stretch, STRETCH_COUNT, seed * 7 + 3).join(', '),
    punct: pick(pools.punct, PUNCT_COUNT, seed * 11 + 5).map(row => JSON.stringify(row)).join(', '),
  };
}

export function buildTail(input: TryTailInput, pack: Record<string, string>): string {
  return asMeeting(packedTail(input, pack));
}

function packedTail(input: TryTailInput, pack: Record<string, string>): string {
  const full = toVendorTail(input);
  const vendor = vendorBuildTail(full);
  const pools = packPools(pack);
  if (!pools) return vendor;

  // `lastStep` is the only block that carries the pools, so it is the only one that is swapped.
  const block = lastStep(full.voiceSeed);
  const snapshot = vendorVoiceSamples(full.voiceSeed);
  const packed = packedSamples(pools, full.voiceSeed);
  const swapped = block
    .replace(snapshot.stretch, () => packed.stretch)
    .replace(snapshot.punct, () => packed.punct)
    .replace(snapshot.samples, () => packed.samples);
  return swapped === block ? vendor : vendor.replace(block, () => swapped);
}

/** The snapshot's own drift lines and first-turn text, read from the vendored tail module. */
export function tailSources(): { common: string[]; law: Record<string, string[]>; firstTurn: string } {
  const source = readFileSync(
    join(baselinePath(readAdapter().targets['irises-web']), 'src/worker/prompt/tail.ts'),
    'utf8',
  );
  const commonBlock = source.match(/const DRIFT_COMMON = \[([\s\S]*?)\n\];/);
  const common = [...(commonBlock?.[1] ?? '').matchAll(/'(- .*?)'/g)].map(match => match[1]);
  const lawBlock = source.match(/const DRIFT_LAW = \{([\s\S]*?)\n\} as const;/);
  const law: Record<string, string[]> = {};
  if (lawBlock) {
    for (const match of lawBlock[1].matchAll(/(\w+): \[([\s\S]*?)\n  \],/g)) {
      law[match[1]] = [...match[2].matchAll(/'(- .*?)'/g)].map(line => line[1]);
    }
  }
  return {
    common,
    law,
    firstTurn: (source.match(/export const FIRST_TURN = '(.*?)';/)?.[1] ?? '').replace(/\\n/g, '\n'),
  };
}
