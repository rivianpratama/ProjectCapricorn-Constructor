import { parseSoul, renderSoul, SOUL_SLOTS, type Soul, type SoulSlot } from './parseSoul';
import { REQUIRED_OPENINGS } from './lint';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINAL: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0 || parts.length === 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

/** A whole number as English words. Long digit strings are read digit by digit, as a phone number would be. */
export function numberWords(digits: string): string {
  if (digits.length > 9) return [...digits].map(d => ONES[Number(d)]).join(' ');
  let n = Number(digits);
  if (n < 1000) return below1000(n);
  const groups: string[] = [];
  for (const [size, name] of [[1_000_000, 'million'], [1000, 'thousand']] as const) {
    if (n >= size) {
      groups.push(`${below1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) groups.push(below1000(n));
  return groups.join(' ');
}

function ordinalWords(digits: string): string {
  const words = numberWords(digits).split(' ');
  const last = words[words.length - 1];
  const ordinal = ORDINAL[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words.slice(0, -1), ordinal].join(' ');
}

/** Every digit written out: "2am" becomes "two am", "3.5" "three point five", "1st" "first", "50%" "fifty percent". */
export function spellDigits(text: string): string {
  return text
    // Indonesian reduplication: "kemana2" is "kemana-kemana", never "kemanatwo".
    .replace(/\b([a-z]{2,})2(?=[a-z]{0,3}\b)/gi, '$1-$1')
    .replace(/(\d+)\s*%/g, (_, n: string) => `${numberWords(n)} percent`)
    .replace(/(\d+)(st|nd|rd|th)\b/gi, (_, n: string) => ordinalWords(n))
    .replace(/(\d+)\.(\d+)/g, (_, a: string, b: string) => `${numberWords(a)} point ${[...b].map(d => ONES[Number(d)]).join(' ')}`)
    .replace(/(\d+)(?=[a-z])/gi, (_, n: string) => `${numberWords(n)} `)
    .replace(/\d+/g, n => numberWords(n))
    .replace(/[ \t]{2,}/g, ' ');
}

const CONNECTIVES: Array<[RegExp, string]> = [
  [/\bHowever\b/g, 'But'],
  [/\bhowever\b/g, 'but'],
  [/\bTherefore\b/g, 'So'],
  [/\btherefore\b/g, 'so'],
  [/\bMoreover\b/g, 'Also'],
  [/\bmoreover\b/g, 'also'],
];

/** Dashes become a comma where they join clauses, and a plain hyphen inside a word or range. */
function plainDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ' , ').replace(/ ,/g, ',').replace(/,\s*,/g, ',');
}

function plainColons(text: string): string {
  return text.replace(/[:：]\s+/g, ', ').replace(/[:：]/g, ' ').replace(/[ \t]{2,}/g, ' ');
}

function prose(slot: SoulSlot, text: string): string {
  let out = spellDigits(text);
  for (const [pattern, replacement] of CONNECTIVES) out = out.replace(pattern, replacement);
  if (slot !== 'iris.banter') out = plainDashes(out);
  if (slot.startsWith('web.')) out = plainColons(out);
  return out;
}

/** The first line a host app relies on. A near miss is replaced, and a missing one is put in front. */
function withOpening(slot: SoulSlot, text: string): string {
  const opening = REQUIRED_OPENINGS[slot];
  if (!opening) return text;
  const body = text.trimStart();
  const first = body.split('\n')[0].trimEnd();
  if (slot === 'iris.banter' ? body.startsWith(opening) : first === opening) return text;
  if (slot === 'iris.banter') {
    const bold = body.match(/^\*\*banter[^*\n]*\*\*/i);
    if (bold) return opening + body.slice(bold[0].length);
    return `${opening}\n\n${body}`;
  }
  const lines = body.split('\n');
  if (/^#{1,6}\s/.test(lines[0])) return [opening, ...lines.slice(1)].join('\n');
  return `${opening}\n\n${body}`;
}

function bubble(text: string): string {
  return plainColons(plainDashes(spellDigits(text))).trim();
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function pools(input: Soul['pools']): Soul['pools'] {
  const strings = (items: string[]) =>
    uniqueBy(items.map(item => bubble(String(item))).filter(Boolean), item => item).slice(0, 24);
  const samples = uniqueBy(
    input.samples
      .map(row => (Array.isArray(row) ? row : [row]).map(item => bubble(String(item))).filter(Boolean).slice(0, 3))
      .filter(row => row.length > 0),
    row => row.join('\u0000'),
  ).slice(0, 24);
  return { samples, stretch: strings(input.stretch), punct: strings(input.punct) };
}

export interface Sanitized {
  markdown: string;
  /** True when anything was rewritten, so SOUL.md was re-rendered from the cleaned soul. */
  changed: boolean;
}

/**
 * Fix what code can fix, so a model's last-mile slips (a digit, an em dash, a colon in a web slot,
 * a duplicate pool item) do not cost a second 24k-token generation or fail the build. Wording
 * problems code cannot fix, such as a placeholder or the "not X, it is Y" turn, are left for the
 * repair turn. A markdown that will not parse is returned as it came so the caller sees the real error.
 */
export function sanitizeSoul(markdown: string): Sanitized {
  let soul: Soul;
  try {
    soul = parseSoul(markdown);
  } catch {
    return { markdown, changed: false };
  }
  const cleaned: Omit<Soul, 'changelog'> = { ...soul, pools: pools(soul.pools) };
  for (const slot of SOUL_SLOTS) {
    if (slot === 'samples' || slot === 'stretch' || slot === 'punct') continue;
    cleaned[slot] = withOpening(slot, prose(slot, soul[slot]));
  }
  const changelog = soul.changelog.map(line => spellDigits(line));
  const rendered = renderSoul({ ...cleaned, changelog });
  const reparsed = parseSoul(rendered);
  const same =
    SOUL_SLOTS.every(slot => ['samples', 'stretch', 'punct'].includes(slot) || reparsed[slot] === soul[slot]) &&
    JSON.stringify(reparsed.pools) === JSON.stringify(soul.pools);
  return same ? { markdown, changed: false } : { markdown: rendered, changed: true };
}
