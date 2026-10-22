import { describe, expect, it } from 'vitest';
import { heldOutCount, inheritanceRules } from '../src/lib/pipeline/rules';

describe('inheritance rules', () => {
  it('handles one parent across three slices with no cap', () => {
    const rules = inheritanceRules(1);
    expect(rules.threshold).toBe(3);
    expect(rules.cap).toBe(1);
    expect(rules.slices).toBe(true);
    expect(rules.note).toContain('all three slices');
  });

  it('handles two parents with a sixty percent cap and no slices', () => {
    const rules = inheritanceRules(2, 2);
    expect(rules.threshold).toBe(2);
    expect(rules.cap).toBeCloseTo(0.6);
    expect(rules.slices).toBe(true);
    expect(rules.note).toContain('at least two relationship types');
  });

  it('handles six parents with a thirty-five percent cap', () => {
    const rules = inheritanceRules(6);
    expect(rules.threshold).toBe(3);
    expect(rules.cap).toBeCloseTo(0.35);
    expect(rules.slices).toBe(false);
    expect(rules.note).not.toContain('two relationship types');
  });

  it('never demands two relationship types when only one exists', () => {
    const rules = inheritanceRules(3, 1);
    expect(rules.note).not.toContain('two relationship types');
    const mixed = inheritanceRules(3, 2);
    expect(mixed.note).toContain('two relationship types');
  });

  it('rejects a parent count outside one to six', () => {
    expect(() => inheritanceRules(0)).toThrow(/one to six|1 to 6/i);
    expect(() => inheritanceRules(7)).toThrow(/one to six|1 to 6/i);
  });

  it('scales the held-out pair target with N', () => {
    expect(heldOutCount(1)).toBe(6);
    expect(heldOutCount(3)).toBe(12);
    expect(heldOutCount(6)).toBe(20);
  });
});
