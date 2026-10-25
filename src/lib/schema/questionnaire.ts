import { z } from 'zod';

export const TRAIT_OPTIONS = ['Keep', 'Soften', 'Only once close', 'Remove'] as const;

export const FIXED_ITEMS = {
  name: { text: 'What should she be called?', options: ['Iris', 'Keep the name from the chats', 'Use a new name'], default: 'Iris' },
  nicknames: { text: 'Nicknames?', options: ['From the chats', 'None', 'I will type one'], default: 'From the chats' },
  relationship: {
    text: 'Who is she to you?',
    options: ['Close friend', 'Partner', 'Family', 'Work', 'Group', 'Acquaintance'],
    default: 'Close friend',
  },
  language: { text: 'Which language?', options: ['Mostly English', 'Mixed', 'Mostly Indonesian'], default: 'Mixed' },
  life_facts: { text: 'Real life details?', options: ['Generalize', 'Fictionalize'], default: 'Generalize' },
  energy: { text: 'How much energy?', options: ['As observed', 'Brighter', 'Calmer'], default: 'As observed' },
  rename: { text: 'Rename Irises in the files too?', options: ['Yes', 'No'], default: 'No' },
} as const;

export const FIXED_IDS = Object.keys(FIXED_ITEMS) as Array<keyof typeof FIXED_ITEMS>;

export const QuestionItemSchema = z.object({
  id: z.string().min(1),
  trait_ref: z.string(),
  text: z.string().min(1),
  quote: z.string(),
  options: z.array(z.string().min(1)).min(2),
  default: z.string().min(1),
});
export type QuestionItem = z.infer<typeof QuestionItemSchema>;

export const QuestionnaireSchema = z
  .object({ items: z.array(QuestionItemSchema).min(10).max(15) })
  .superRefine((value, ctx) => {
    const ids = value.items.map(item => item.id);
    for (const id of FIXED_IDS) {
      if (!ids.includes(id)) ctx.addIssue({ code: 'custom', message: `questionnaire is missing the ${id} item` });
    }
    const seen = new Set<string>();
    for (const item of value.items) {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', message: `duplicate questionnaire id ${item.id}` });
      seen.add(item.id);
      if (!item.options.includes(item.default)) {
        ctx.addIssue({ code: 'custom', message: `${item.id} default is not one of its options` });
      }
      const fixed = FIXED_ITEMS[item.id as keyof typeof FIXED_ITEMS];
      if (fixed) {
        if (item.options.join('|') !== fixed.options.join('|')) {
          ctx.addIssue({ code: 'custom', message: `${item.id} must use its fixed options` });
        }
      } else if (item.id.startsWith('trait-')) {
        if (item.options.join('|') !== TRAIT_OPTIONS.join('|')) {
          ctx.addIssue({ code: 'custom', message: `${item.id} must use the four trait options` });
        }
        if (!item.trait_ref.trim()) {
          ctx.addIssue({ code: 'custom', message: `${item.id} needs a trait_ref` });
        }
      } else {
        ctx.addIssue({ code: 'custom', message: `unknown questionnaire id ${item.id}` });
      }
    }
  });
export type Questionnaire = z.infer<typeof QuestionnaireSchema>;

export function parseQuestionnaire(value: unknown): Questionnaire {
  return QuestionnaireSchema.parse(value);
}

/** Answers keyed by item id, defaulted to each item's own default. */
export function defaultAnswers(questionnaire: Questionnaire): Record<string, string> {
  return Object.fromEntries(questionnaire.items.map(item => [item.id, item.default]));
}

/** The seven fixed questions, written by code so the model never spends tokens on them. */
export function fixedItems(): QuestionItem[] {
  return FIXED_IDS.map(id => {
    const spec = FIXED_ITEMS[id];
    return { id, trait_ref: '', text: spec.text, quote: '', options: [...spec.options], default: spec.default };
  });
}

const MAX_ITEMS = 15;

/**
 * Phase 3a writes only trait items. This keeps those, drops any fixed id the model wrote anyway,
 * trims to the room left under the cap (life-fact items first), and puts the fixed items in front.
 */
export function buildQuestionnaire(value: unknown): Questionnaire {
  const raw = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) throw new Error('questionnaire has no items');
  const traits = raw.filter(
    (item): item is QuestionItem => typeof (item as QuestionItem | null)?.id === 'string' && (item as QuestionItem).id.startsWith('trait-'),
  );
  const room = MAX_ITEMS - FIXED_IDS.length;
  const facts = traits.filter(item => item.id.startsWith('trait-fact-'));
  const rest = traits.filter(item => !item.id.startsWith('trait-fact-'));
  const keep = new Set([...facts.slice(0, room), ...rest.slice(0, Math.max(room - facts.length, 0))]);
  return parseQuestionnaire({ items: [...fixedItems(), ...traits.filter(item => keep.has(item))] });
}
