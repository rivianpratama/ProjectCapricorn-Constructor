export interface LintIssue {
  slot: string;
  rule: string;
  detail: string;
}

const RULES: Array<{ rule: string; test: (text: string) => string | null }> = [
  { rule: 'no-digit', test: text => text.match(/\d/) ? `contains a digit (${text.match(/\d/)![0]})` : null },
  { rule: 'no-em-dash', test: text => /[—–]/.test(text) ? 'contains an em or en dash' : null },
  { rule: 'no-placeholder', test: text => text.match(/\{\w+\}/) ? `contains a placeholder (${text.match(/\{\w+\}/)![0]})` : null },
  { rule: 'no-llm-connective', test: text => text.match(/\b(however|therefore|moreover)\b/i) ? `uses "${text.match(/\b(however|therefore|moreover)\b/i)![0]}"` : null },
  { rule: 'no-antithesis', test: text => /\bit'?s not [^.,;]{1,40}, it'?s\b/i.test(text) ? 'uses the "not X, it is Y" antithesis' : null },
  {
    rule: 'no-chat-talk',
    // Only phrases that can come from the build itself. "the report" or "your parents" are ordinary speech.
    test: text => {
      const hit = text.match(/\b(engrams?|the chats|the builder|the transcript|the memory file|the parent chats?)\b/i);
      return hit ? `mentions how it was made ("${hit[0]}")` : null;
    },
  },
  { rule: 'no-pii-marker', test: text => /\bPerson [A-Z]\b/.test(text) ? 'still carries a pseudonym marker' : null },
];

/** Section openings the target apps rely on. A pack that moves them breaks the host. */
export const REQUIRED_OPENINGS: Record<string, string> = {
  'iris.persona': '## Who is typing, in every lane',
  'iris.how': '## How you write (strict, this matters)',
  'iris.language': '## Language',
  'iris.banter': '**Banter — the play frame.**',
  'web.persona': '## Who you are',
  'web.how': '## How you write',
};

/** Lints that hold for both targets. `iris.banter` keeps the em dash that is part of its anchor line. */
export function lintSoul(soul: Record<string, string>): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [slot, opening] of Object.entries(REQUIRED_OPENINGS)) {
    if (!soul[slot]?.trimStart().startsWith(opening)) {
      issues.push({ slot, rule: 'opening-line', detail: `must start with "${opening}"` });
    }
  }
  for (const [slot, text] of Object.entries(soul)) {
    for (const rule of RULES) {
      if (rule.rule === 'no-em-dash' && slot === 'iris.banter') continue;
      const detail = rule.test(text);
      if (detail) issues.push({ slot, rule: rule.rule, detail });
    }
    // IrisesWeb scans its whole system prompt and tail for colons, so its slots carry none.
    if (slot.startsWith('web.') && /[:：]/.test(text)) {
      issues.push({ slot, rule: 'no-colon', detail: 'contains a colon' });
    }
  }
  return issues;
}

export interface PoolIssue {
  pool: string;
  detail: string;
}

export function lintPools(pools: { samples: string[][]; stretch: string[]; punct: string[] }): PoolIssue[] {
  const issues: PoolIssue[] = [];
  const check = (name: keyof typeof pools, min = 12, max = 24) => {
    const value = pools[name];
    if (value.length < min) issues.push({ pool: name, detail: `has ${value.length} items, needs at least ${min}` });
    if (value.length > max) issues.push({ pool: name, detail: `has ${value.length} items, keep at most ${max}` });
    const flat = value.map(item => (Array.isArray(item) ? item.join('\u0000') : item));
    if (new Set(flat).size !== flat.length) issues.push({ pool: name, detail: 'has duplicate items' });
    for (const item of value) {
      const bubbles = Array.isArray(item) ? item : [item];
      if (bubbles.some(bubble => !bubble.trim())) issues.push({ pool: name, detail: 'has an empty item' });
      if (bubbles.some(bubble => /[—–]/.test(bubble))) issues.push({ pool: name, detail: 'uses an em or en dash' });
      if (bubbles.some(bubble => /[:：]/.test(bubble))) issues.push({ pool: name, detail: 'uses a colon' });
    }
  };
  check('samples');
  check('stretch');
  check('punct');
  for (const row of pools.samples) {
    if (row.length > 3) issues.push({ pool: 'samples', detail: `a sample has ${row.length} bubbles, keep at most three` });
  }
  return issues;
}

/**
 * How much of a slot may be Iris's sentences, verbatim. The persona slots must be the child's own; the
 * language slot carries a tool contract and the fidelity rule, so it may keep more of hers.
 */
export const COPY_LIMITS: Record<string, number> = {
  'iris.persona': 0.25,
  'iris.how': 0.35,
  'iris.language': 0.7,
  'iris.banter': 0.35,
  'web.persona': 0.25,
  'web.how': 0.35,
};

/** Iris's own facts and habits. Any of these surviving means her persona leaked through. */
export const IRIS_RESIDUE = [
  'Jakarta',
  'olympiad',
  'prodigy',
  'SaaS',
  'succulent',
  'david',
  'matcha',
  'IELTS',
  'Global South',
  'jester',
  'comfort show',
  'whatsapp stickers',
];

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Sentences long enough to say something; short ones ("Six steps.") collide by chance. */
function sentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => sentence.length > 25);
}

/** The slot's sentences that are Iris's word for word, longest first, so a repair turn knows what to rewrite. */
export function copiedSentences(text: string, base: string): string[] {
  const theirs = new Set(sentences(base));
  return sentences(text).filter(sentence => theirs.has(sentence)).sort((a, b) => b.length - a.length);
}

/** Share of a slot's sentence text that is copied word for word from Iris's version of the slot. */
export function copiedShare(text: string, base: string): number {
  const theirs = new Set(sentences(base));
  const ours = sentences(text);
  const total = ours.reduce((sum, sentence) => sum + sentence.length, 0);
  if (!total) return 0;
  const copied = ours.filter(sentence => theirs.has(sentence)).reduce((sum, sentence) => sum + sentence.length, 0);
  return copied / total;
}

/**
 * The soul is a new person in Iris's slots, not Iris with a new bio. Flags slots that keep too much of
 * her text, and Iris facts that survived. A residue term the report itself uses belongs to the child.
 */
export function lintOriginality(soul: Record<string, string>, base: Record<string, string>, report = ''): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [slot, limit] of Object.entries(COPY_LIMITS)) {
    if (soul[slot] === undefined || base[slot] === undefined) continue;
    const share = copiedShare(soul[slot], base[slot]);
    if (share > limit) {
      issues.push({
        slot,
        rule: 'copied-from-iris',
        detail: `${Math.round(share * 100)} percent of its sentences are Iris's word for word, keep it under ${Math.round(limit * 100)} and write the rest as the child. Rewrite these first, ${copiedSentences(soul[slot], base[slot]).slice(0, 6).map(line => `"${line}"`).join(', ')}`,
      });
    }
  }
  const known = report.toLowerCase();
  for (const term of IRIS_RESIDUE) {
    if (known.includes(term.toLowerCase())) continue;
    const pattern = new RegExp(`\\b${term.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i');
    for (const [slot, text] of Object.entries(soul)) {
      if (COPY_LIMITS[slot] !== undefined && pattern.test(text)) {
        issues.push({ slot, rule: 'iris-residue', detail: `still carries Iris's "${term}"` });
      }
    }
  }
  return issues;
}

/** The web target is the compressed one, and its prompt must stay small. */
export function lintWebLength(soul: Record<string, string>, others: number, limit = 30_000): LintIssue[] {
  const total = soul['web.persona'].length + soul['web.how'].length + others;
  if (total >= limit) {
    return [{ slot: 'web', rule: 'system-prompt-length', detail: `system prompt would be ${total} characters, limit ${limit}` }];
  }
  return [];
}
