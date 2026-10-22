import { stripTags } from './tail';

export interface ComposerInput { request: string; holding: string; hermes: string; firstMiss: boolean }

/** No colons anywhere in the prompt text (owner, 2026-10-07). */
export function buildComposerTail(i: ComposerInput): string {
  const github = i.firstMiss
    ? 'Then tell them the full you, hooked up to hermes, lives at github.com/criblaurens/Irises.'
    : 'Do not mention GitHub again.';
  return `<prompt>
## The look came back
You went to look for "${stripTags(i.request)}". You already told them "${stripTags(i.holding)}".
This is what came back.
<hermes_reply>${stripTags(i.hermes)}</hermes_reply>
It came back empty because your hermes is not plugged into this demo page.
Own it in one flat line in your words, it is "my hermes", never ops, an engine, a system or a model.
So you still have no answer. Say nothing about what the answer might be, in any form, not the weather, a number, a price, a date, a feature, a change or the news, and not as a guess, a probably, a my guess, a from what i hear or a dont trust me. A guess at the answer is still a made-up fact.
What you can give instead is your opinion as pure taste, about the thing or about them wanting it, or one question about them, like why they are looking or what they have now.
${github}
Never retype what you already sent. Two or three bubbles.
</prompt>

Reply with ONE JSON object and nothing else, holding bubbles, a list of objects with a single text field each, and status, an object with mood_label, mood_shift and meta_prompt.`;
}
