/**
 * Waiting till they're done, ported from Licanote (src/lib/chat/burst.ts) with its numbers.
 * People text in little bubbles, so she holds off until they've stopped, then answers the
 * whole run at once. The box is ours and every keystroke is seen, so typing alone decides:
 * an empty box after a send means they're done and she answers after a short beat; text
 * left in the box means they're mid-thought, so she gives them longer; any keystroke
 * restarts the wait. The short beat is theirs: she learns how long they usually take to
 * start the next bubble. Her dots come up when they stop typing and go away when they
 * start again, and after a couple of tries she just waits.
 */

export interface BurstConfig {
  /** quiet after a send with the box empty: they're done (until she's learned their rhythm) */
  quietMs: number;
  /** however slow their rhythm, she never waits longer than this after a send */
  maxQuietMs: number;
  /** a next bubble started within this of a send continues the run (longer is a new thought) */
  goOnWithinMs: number;
  /** how long after their last keystroke they count as stopped typing, so she can carry on */
  stoppedMs: number;
  /** quiet with a half-written message in the box: they may still send it */
  draftMs: number;
  /** how soon her dots come up once they stop typing */
  noticeMs: number;
  /** added to that each time they typed again and her dots went away */
  noticeStepMs: number;
  /** after her dots went away this many times, they stay down until she actually replies */
  maxNotices: number;
}

export const BURST: BurstConfig = {
  quietMs: 800,
  maxQuietMs: 2200,
  goOnWithinMs: 2000,
  stoppedMs: 1200,
  draftMs: 3000,
  noticeMs: 600,
  noticeStepMs: 900,
  maxNotices: 2,
};

/** How many of their recent gaps (send to next keystroke) she goes by. */
const GAPS_KEPT = 8;

/** One message they send: the input takes no more (Composer maxLength), the server refuses more (guard.ts). */
export const MAX_MESSAGE_CHARS = 500;

/** The run goes to the server as one message, within its 2000-char limit (guard.ts MAX_TURN_TEXT). */
export const MAX_RUN_CHARS = 2000;

/** Their gaps with a new one: how long they took to start typing again after a send. */
export function rememberGap(gaps: number[], gap: number, cfg: BurstConfig = BURST): number[] {
  if (!(gap >= 0) || gap > cfg.goOnWithinMs) return gaps;
  return [...gaps, gap].slice(-GAPS_KEPT);
}

/** Their rhythm: a bit longer than their usual gap (leaning to their slower ones), between quietMs and maxQuietMs. */
export function quietFor(gaps: number[], cfg: BurstConfig = BURST): number {
  if (!gaps.length) return cfg.quietMs;
  const sorted = [...gaps].sort((a, b) => a - b);
  const usual = sorted[Math.ceil(0.75 * (sorted.length - 1))];
  return Math.min(Math.max(Math.round(usual * 1.25), cfg.quietMs), cfg.maxQuietMs);
}

/** How long from now until she answers: counted from their last send or keystroke. */
export function answerInMs(
  opts: { lastActivityAt: number; now: number; drafting: boolean; quietMs?: number },
  cfg: BurstConfig = BURST,
): number {
  return Math.max(0, opts.lastActivityAt + (opts.drafting ? cfg.draftMs : (opts.quietMs ?? cfg.quietMs)) - opts.now);
}

/** Still typing: how long until they count as stopped (0 when they already have). */
export function stillTypingMs(opts: { lastActivityAt: number; now: number }, cfg: BurstConfig = BURST): number {
  return Math.max(0, opts.lastActivityAt + cfg.stoppedMs - opts.now);
}

/** How long from now until her dots come up, or null when they've sent them away `maxNotices` times this wait. */
export function noticeInMs(
  opts: { lastActivityAt: number; now: number; hidden: number; baseMs?: number },
  cfg: BurstConfig = BURST,
): number | null {
  if (opts.hidden >= cfg.maxNotices) return null;
  return Math.max(0, opts.lastActivityAt + (opts.baseMs ?? cfg.noticeMs) + opts.hidden * cfg.noticeStepMs - opts.now);
}

/** Their run as one message: numbered [msg N] lines when there are several (as in Licanote). */
export function joinRun(texts: string[]): string {
  const text = texts.length === 1 ? texts[0] : texts.map((t, i) => `[msg ${i + 1}] ${t}`).join('\n');
  if (text.length <= MAX_RUN_CHARS) return text;
  const cut = text.slice(0, MAX_RUN_CHARS);
  // never end on half an emoji: a lone high surrogate would be a broken character on the wire
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
