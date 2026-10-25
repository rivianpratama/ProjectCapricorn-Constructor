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

/** A numbered line that could be a heading: where it starts, its raw text, the title inside it, and how marked it is. */
interface Heading {
  index: number;
  length: number;
  title: string;
  /** 0 for a bare `1. X` line, 1 for bold, 2..6 for an H2..H6 hash heading. */
  rank: number;
  /** Lines of prose between the previous heading's start and this one; a heading follows a short one. */
  gap?: number;
}

/** The title inside a heading: a numbered line such as `1. Context`. */
const NUMBERED = /^\d+\.[ \t]+\S/;

/**
 * Split a Markdown document on its numbered headings, keeping the H1 title and any text before
 * the first heading.
 *
 * Models write the same document in many shapes: H2 as the prompt asks, H1 or H6 when they
 * forget, bold lines when they think it reads better, and a numbered list such as the eight
 * novel situations that is content, not structure. Ranked headings and a fenced-line map exist
 * to tell those apart: the document's headings are the heaviest shape that starts at 1 and runs
 * forward, and lighter or later numbers stay inside a body the way a list should.
 */
export function splitSections(markdown: string): Document {
  const text = stripReasoning(unwrapFence(markdown.replace(/\r\n/g, '\n').trim()));

  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  const candidates: Heading[] = [];
  let offset = 0;
  let gap = 0;
  for (const [i, line] of lines.entries()) {
    const heading = fenced.has(i) ? null : readHeading(line, offset);
    if (heading) {
      candidates.push({ ...heading, gap });
      gap = 0;
    } else if (line.trim()) {
      gap += 1;
    }
    offset += line.length + 1;
  }

  const headings = structure(candidates);
  const sections: Section[] = headings.map((heading, i) => {
    const from = heading.index + heading.length;
    const to = headings[i + 1]?.index ?? text.length;
    return { index: i + 1, title: heading.title, body: text.slice(from, to).trim() };
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
  const match = title.match(/(?:^|[^\d])(\d+)\./);
  return match ? Number(match[1]) : null;
}

/**
 * The headings that carry the document: the heaviest hash shape that starts at 1, run forward.
 * A bare `1. X` line is a heading only when the document has no hash headings at all, because
 * numbered lines inside a body are far more often a list. When no shape starts at 1, the
 * longest run wins: a document missing its first heading is closer to done than one split
 * into many small pieces.
 */
function structure(candidates: Heading[]): Heading[] {
  if (candidates.length === 0) return [];
  const ranks = [...new Set(candidates.map(candidate => candidate.rank))]
    .filter(rank => rank > 0)
    .sort((a, b) => b - a);
  for (const rank of ranks) {
    const group = candidates.filter(candidate => candidate.rank === rank);
    if (group.length > 1 && numberedIndex(group[0].title) === 1) return numberedRun(group);
  }
  const shapes = ranks.length ? ranks : [0];
  let best: Heading[] = [];
  for (const rank of shapes) {
    const group = numberedRun(candidates.filter(candidate => candidate.rank === rank));
    if (group.length > best.length) best = group;
  }
  return best;
}

/** How much prose a section may hold between two of its headings before a skipped number is real. */
const SECTION_PROSE = 30;

/**
 * Numbered headings from the first `1.` on. A number below the last one seen belongs to a list
 * inside a body, so the run ends there. A skipped number keeps the heading when the gap is small
 * or the heading arrives after a long body, which is what a missing section looks like; a jump
 * from `7.` to `9.` two lines later is a numbered list in the prose, so the run ends there too.
 */
function numberedRun(headings: Heading[]): Heading[] {
  const start = headings.findIndex(heading => numberedIndex(heading.title) === 1);
  if (start < 0) return [];
  const out: Heading[] = [headings[start]];
  let prose = headings[start].gap ?? 0;
  for (const heading of headings.slice(start + 1)) {
    const previous = numberedIndex(out[out.length - 1].title) ?? 0;
    const index = numberedIndex(heading.title) ?? 0;
    const gap = (heading.gap ?? 0) + prose;
    if (index < previous) break;
    if (index === previous + 1 || gap <= SECTION_PROSE) {
      out.push({ ...heading, gap: 0 });
      prose = 0;
    } else {
      prose = gap;
    }
  }
  return out;
}

/** `1. X` followed by a short secondary label becomes `1. X (label)`, so it names the same section. */
function stripNumbering(title: string): string {
  const labelled = title.match(/^(\d+\. [^()]+?)\s*\(\s*([^()\d][^()]{0,20}?)\s*\)$/);
  return labelled ? `${labelled[1]} (${labelled[2]})` : title;
}

/** One heading line, or null when the line is prose that only looks like one. */
function readHeading(line: string, offset: number): Heading | null {
  const hashed = line.match(/^[ \t]*(#{1,6})[ \t]+(.+?)[ \t]*$/);
  if (hashed) {
    const title = stripNumbering(hashed[2].replace(/[ \t]+#+$/, '').trim());
    if (!NUMBERED.test(title)) return null;
    return { index: offset, length: line.length, title, rank: hashed[1].length };
  }

  // A bold numbered line (`**1. X**`, `**1. X:**`) outranks a bare one; either way the line is
  // the whole heading, so an emphasis run inside a sentence never splits a body.
  const bold = line.match(/^[ \t]*\*{1,2}[ \t]*(\d+\.[ \t]+.+?(?<!\*):?)[ \t]*(?:\*{1,2})?:?[ \t]*$/);
  const bare = line.match(/^[ \t]*(\d+\.[ \t]+[^\n*#:]+?)[ \t]*$/);
  for (const [rank, match] of [[1, bold], [0, bare]] as const) {
    if (!match) continue;
    const title = stripNumbering(match[1].trim());
    if (NUMBERED.test(title)) return { index: offset, length: line.length, title, rank };
  }
  return null;
}

/** The outer code fence some models wrap the whole answer in. */
function unwrapFence(text: string): string {
  if (!text.startsWith('```')) return text;
  return text.replace(/^```[^\n]*\n/, '').replace(/\n```[^\n]*$/, '').trim();
}

function stripReasoning(text: string): string {
  if (!text.includes('</think>')) return text;
  return text.replace(/^<think[\s\S]*?<\/think>\s*/i, '').trim();
}

/** Line numbers inside fenced code blocks, fences included: a heading there is an example, not structure. */
function fencedLines(lines: string[]): Set<number> {
  const fenced = new Set<number>();
  let open: string | null = null;
  for (const [i, line] of lines.entries()) {
    const match = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1][0];
      if (open === null) open = marker;
      else if (marker === open) open = null;
      fenced.add(i);
      continue;
    }
    if (open !== null) fenced.add(i);
  }
  return fenced;
}
