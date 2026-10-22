export interface Section {
  index: number;
  title: string;
  body: string;
}

export interface Document {
  title: string | null;
  sections: Section[];
  rest: string;
}

/** Split a Markdown document on H2 headings, keeping the H1 title and any text before the first H2. */
export function splitSections(markdown: string): Document {
  const text = markdown.replace(/\r\n/g, '\n').trim();
  const headings = [...text.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
  const sections: Section[] = headings.map((heading, i) => {
    const from = (heading.index ?? 0) + heading[0].length;
    const to = headings[i + 1]?.index ?? text.length;
    return { index: i + 1, title: heading[1].trim(), body: text.slice(from, to).trim() };
  });
  const first = headings[0]?.index ?? text.length;
  const head = text.slice(0, first);
  const titleMatch = head.match(/^#[ \t]+(.+?)[ \t]*$/m);
  const rest = head
    .split('\n')
    .filter(line => !/^#[ \t]+/.test(line))
    .join('\n')
    .trim();
  return { title: titleMatch ? titleMatch[1].trim() : null, sections, rest };
}

/** Numbered headings such as `## 3. Moves (L2)` -> `3. Moves (L2)`. */
export function numberedTitle(title: string): string {
  return title.replace(/^(\d+)\.\s*/, '$1. ');
}

export function numberedIndex(title: string): number | null {
  const match = title.match(/^(\d+)\./);
  return match ? Number(match[1]) : null;
}
