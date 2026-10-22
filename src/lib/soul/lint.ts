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
  { rule: 'no-chat-talk', test: text => /\b(the engram|the report|the chats|your parents|the builder|the transcript)\b/i.test(text) ? 'mentions how it was made' : null },
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

/** The web target is the compressed one, and its prompt must stay small. */
export function lintWebLength(soul: Record<string, string>, others: number, limit = 30_000): LintIssue[] {
  const total = soul['web.persona'].length + soul['web.how'].length + others;
  if (total >= limit) {
    return [{ slot: 'web', rule: 'system-prompt-length', detail: `system prompt would be ${total} characters, limit ${limit}` }];
  }
  return [];
}
