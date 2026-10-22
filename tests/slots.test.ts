import { describe, expect, it } from 'vitest';
import {
  extractSlots,
  readAdapter,
  readSlotFile,
  renderFile,
  soulSlotsFor,
} from '../src/lib/soul/slots';

const adapter = readAdapter();

describe('slot adapter', () => {
  for (const target of Object.values(adapter.targets)) {
    describe(target.label, () => {
      for (const file of target.files) {
        it(`round-trips ${file.path} byte for byte`, () => {
          const slotFile = readSlotFile(target, file);
          const extracted = extractSlots(slotFile);
          const rendered = renderFile(slotFile, extracted, { raw: true });
          expect(rendered.source).toBe(slotFile.source);
          expect(rendered.bytes).toBe(Buffer.byteLength(slotFile.source));
        });

        it(`finds every ${file.path} slot in order`, () => {
          const slotFile = readSlotFile(target, file);
          expect(slotFile.slots).toHaveLength(file.slots.length);
          expect(slotFile.slots.map(slot => slot.id)).toEqual(file.slots.map(slot => slot.id));
        });
      }
    });
  }

  it('keeps machinery exports and counts untouched', () => {
    const web = adapter.targets['irises-web'];
    const voiceFile = web.files.find(file => file.path.endsWith('voice.ts'))!;
    const personaFile = web.files.find(file => file.path.endsWith('persona.ts'))!;
    const voiceSlot = readSlotFile(web, voiceFile);
    const personaSlot = readSlotFile(web, personaFile);
    expect(voiceSlot.source).toContain('export function pick');
    expect(voiceSlot.source).toContain('export function voiceSamplesFor');
    expect(voiceSlot.source).toContain('export const SAMPLE_COUNT = 6;');
    expect(personaSlot.source).toContain('export const PERSONA');
    expect(personaSlot.source).toContain('export const HOW_YOU_WRITE');
  });

  it('exposes the soul slots each target needs', () => {
    expect(soulSlotsFor('irises')).toEqual([
      'iris.persona',
      'samples',
      'stretch',
      'punct',
      'iris.how',
      'iris.language',
      'iris.banter',
    ]);
    expect(soulSlotsFor('irises-web')).toEqual([
      'web.persona',
      'web.how',
      'samples',
      'stretch',
      'punct',
    ]);
  });
});
