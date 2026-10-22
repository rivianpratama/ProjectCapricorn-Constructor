import { describe, expect, it } from 'vitest';
import {
  FIXED_ITEMS,
  QuestionnaireSchema,
  defaultAnswers,
  parseQuestionnaire,
  type QuestionItem,
} from '../src/lib/schema/questionnaire';

function fixed(id: keyof typeof FIXED_ITEMS): QuestionItem {
  const spec = FIXED_ITEMS[id];
  return {
    id,
    trait_ref: '',
    text: id,
    quote: '',
    options: [...spec.options],
    default: spec.default,
  };
}

const trait = (n: number): QuestionItem => ({
  id: `trait-${n}`,
  trait_ref: `T${n}`,
  text: `trait ${n}`,
  quote: 'a real quote',
  options: ['Keep', 'Soften', 'Only once close', 'Remove'],
  default: 'Keep',
});

const valid = {
  items: [
    fixed('name'),
    fixed('nicknames'),
    fixed('relationship'),
    fixed('language'),
    fixed('life_facts'),
    fixed('energy'),
    fixed('rename'),
    trait(1),
    trait(2),
    trait(3),
  ],
};

describe('questionnaire schema', () => {
  it('accepts the seven fixed items plus trait items', () => {
    const parsed = parseQuestionnaire(valid);
    expect(parsed.items).toHaveLength(10);
    expect(defaultAnswers(parsed).name).toBe('Iris');
    expect(defaultAnswers(parsed)['trait-1']).toBe('Keep');
  });

  it('rejects a missing fixed item', () => {
    const items = valid.items.filter(item => item.id !== 'energy');
    expect(() => parseQuestionnaire({ items })).toThrow(/missing the energy item/);
  });

  it('rejects more than fifteen items', () => {
    const items = [...valid.items, trait(4), trait(5), trait(6), trait(7), trait(8), trait(9)];
    expect(() => parseQuestionnaire({ items })).toThrow();
  });

  it('rejects fewer than ten items', () => {
    expect(() => parseQuestionnaire({ items: valid.items.slice(0, 9) })).toThrow();
  });

  it('rejects trait items that do not use the four options', () => {
    const items = [...valid.items.slice(0, 7), { ...trait(1), options: ['Keep', 'Remove'] }];
    expect(() => parseQuestionnaire({ items })).toThrow(/four trait options/);
  });

  it('rejects a default that is not among the options', () => {
    const items = [...valid.items.slice(0, 7), { ...trait(1), default: 'Maybe' }];
    expect(() => parseQuestionnaire({ items })).toThrow(/default is not one of its options/);
  });

  it('rejects an unknown item id', () => {
    const items = [...valid.items.slice(0, 7), { ...trait(1), id: 'favourite-food' }];
    expect(() => parseQuestionnaire({ items })).toThrow(/unknown questionnaire id/);
  });

  it('rejects a trait item with no trait_ref', () => {
    const items = [...valid.items.slice(0, 7), { ...trait(1), trait_ref: '  ' }];
    expect(() => parseQuestionnaire({ items })).toThrow(/needs a trait_ref/);
  });

  it('rejects duplicate ids', () => {
    const items = [...valid.items.slice(0, 7), trait(1), trait(1), trait(2)];
    expect(() => parseQuestionnaire({ items })).toThrow(/duplicate questionnaire id/);
  });

  it('exports the schema for reuse', () => {
    expect(QuestionnaireSchema.safeParse(valid).success).toBe(true);
  });
});
