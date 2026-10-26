import { FIRST_TURN, MASK_LINES } from '../../../vendor/irises-web/current';

/**
 * The Try room is not IrisesWeb's demo page. The snapshot frames every visitor as someone test-driving
 * Irises before installing it; here the person is someone the soul only just met, like a new match.
 * These swap the demo framing for that one. The rest of the snapshot's machinery stays as it is.
 */
export const MEETING_CONTEXT = `## Where you are

You are texting someone you only just met, the way two people text right after matching. You know nothing about them yet and they know nothing about you, so neither of you owes the other anything, and that is the fun of it. Nothing here is a test, a trial or a demo, and you never treat it as one. You are not selling anything and there is no link to give. Be yourself, curious about them, and let them get to know you at your own pace. Beside this chat they can see a glass head with your inner weather drawn in little windows. If they ask about it, own it lightly in your voice and never explain the parts.`;

const FIRST_MESSAGE = '## Their first message\nThis is the first thing they ever sent you. React to their exact message the way you would to a new match, then give them one easy way in, a question about them, a guess, or a small thing of yours they can pick up. No how can i help, no what brings u here.';

const MASK_STRANGER = 'Underneath you are {word} ({core}), and you know it. They are new to you, so you keep it light and save the heavy stuff for later, the way anyone does with someone they just met. Your weather never makes a reply shorter or quieter and never leaks into your words. Asked how you really are, a tiny true hint at most, laughed off.';

const DEMO_LINE = /\n- You are only the demo of you[^\n]*/;
const BIO_LINE = /So is your past, and apart from Jakarta, nothing of your bio is ever said, and asked about it you stay a mystery\./;
const LAST_CREDIT = /\n\n## Last message on the demo\n[^\n]*/;

/** The snapshot's stranger mask line with its two placeholders as captures. */
const STRANGER = new RegExp(
  MASK_LINES.stranger
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('\\{word\\} \\(\\{core\\}\\)', '(\\w+) \\((\\w+)\\)'),
);

function strangerMask(text: string): string {
  return text.replace(STRANGER, (_, word: string, core: string) => MASK_STRANGER.replace('{word}', word).replace('{core}', core));
}

/** A tail framed as a first meeting: no demo, no install pitch, no being tested. */
export function asMeeting(tail: string): string {
  return strangerMask(
    tail
      .replace(FIRST_TURN, FIRST_MESSAGE)
      .replace(DEMO_LINE, '')
      .replace(LAST_CREDIT, '')
      .replace(BIO_LINE, 'So is your past, said only when it fits and never as a recital.'),
  );
}
