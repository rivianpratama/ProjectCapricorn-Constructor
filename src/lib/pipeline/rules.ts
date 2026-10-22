export interface InheritanceRules {
  n: number;
  threshold: number;
  cap: number;
  slices: boolean;
  note: string;
}

export function inheritanceRules(n: number, relationshipTypes = 1): InheritanceRules {
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error('N must be 1 to 6');
  const threshold = n === 1 ? 3 : Math.max(2, Math.ceil(n / 2));
  const cap = n === 1 ? 1 : Math.max(0.35, 1 / n + 0.1);
  const slices = n < 3;
  const sliceNote = n === 1
    ? 'This chat is the only parent, so treat its early, middle and late slices as three sources. A dominant trait appears in all three slices. The cap does not apply.'
    : slices
      ? 'Each chat also splits into early, middle and late slices. Use slices to test whether a trait is stable, but count chats, not slices, toward the threshold.'
      : 'Slices are not needed at this N. Count chats toward the threshold and apply the cap when weighing.';
  return {
    n,
    threshold,
    cap,
    slices,
    note: `Dominant means at least ${threshold} of ${n} chats${n > 1 && relationshipTypes > 1 ? ' and at least two relationship types' : ''}. Per-chat evidence cap is ${Math.round(cap * 100)}%. ${sliceNote}`,
  };
}

export function heldOutCount(n: number): number {
  return Math.max(6, Math.min(20, n * 4));
}
