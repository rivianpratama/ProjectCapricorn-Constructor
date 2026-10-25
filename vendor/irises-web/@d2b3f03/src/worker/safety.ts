// Self-harm lexicon, English and Indonesian only. A hit does not replace the model: the turn
// still goes to her, with the `## Careful` section added to the tail (prompt/tail.ts), and the
// hook kill switch cannot silence it (turn.ts). Keep it narrow: figures of speech ("this bug is
// killing me") must not match.
const CRISIS = [
  /\b(kill(ing)?|hurt(ing)?|cut(ting)?)\s+myself\b/i,
  /\bsuicid/i,
  /\bend(ing)?\s+my\s+life\b/i,
  /\bend(ing)?\s+it\s+all\b/i,
  /\bwant(ed)?\s+to\s+die\b/i,
  /\bwanna\s+die\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\bself[-\s]?harm\b/i,
  /\boverdos/i,
  /\bbunuh\s+diri\b/i,
  /\b(ingin|pengen|mau)\s+mati\b/i,
  /\bmenyakiti\s+diri\b/i,
  /\b(mengakhiri|akhiri)\s+hidup\b/i,
];

export function isCrisis(text: string): boolean {
  return CRISIS.some(re => re.test(text));
}
