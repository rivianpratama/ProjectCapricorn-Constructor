/** Split one line of `label: value, label: value` prose into labelled fields. */
export function labelledFields(line: string, labels: readonly string[]): Record<string, string> {
  const found: Array<{ label: string; from: number; to: number }> = [];
  for (const label of labels) {
    const pattern = new RegExp('`?' + label + '`?\\s*[:=]', 'gi');
    for (const match of line.matchAll(pattern)) {
      found.push({ label: label.toLowerCase(), from: (match.index ?? 0) + match[0].length, to: line.length });
    }
  }
  found.sort((a, b) => a.from - b.from);
  const out: Record<string, string> = {};
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1].from - found[i + 1].label.length : found[i].to;
    const value = line.slice(found[i].from, i + 1 < found.length ? trimLabelStart(line, found[i + 1]) : end);
    if (out[found[i].label] === undefined) out[found[i].label] = value.trim();
  }
  return out;
}

function trimLabelStart(line: string, next: { label: string; from: number }): number {
  const before = line.slice(0, next.from);
  const marker = before.search(new RegExp('`?' + next.label + '`?\\s*[:=]\\s*$', 'i'));
  return marker >= 0 ? marker : next.from;
}
