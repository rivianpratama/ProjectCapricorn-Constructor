import { describe, expect, it } from 'vitest';
import { POST as tryPost } from '../app/api/try/route';
import { toVendorTail } from '../src/lib/fidelity/tail';
import { asMeeting } from '../src/lib/fidelity/meeting';
import { advanceTryState, planTryTurn, readEnvelope, type TryState } from '../src/lib/fidelity/tryloop';
import {
  buildTail as vendorBuildTail,
  computeClock,
  finishChatTurn,
  initialAffect,
  jsonAnchor,
  planTurn,
  runLength,
  voiceSamplesFor as vendorVoiceSamples,
  type Envelope,
  type HookKind,
} from '../vendor/irises-web/current';

const TZ = 'Asia/Jakarta';
const NOW = Date.UTC(2026, 9, 22, 15, 0);

interface Sent {
  body: { messages: Array<{ role: string; content: string }> };
}

interface Answer {
  state: TryState;
  usage: { prompt: number; completion: number };
  turn: { quietForced: boolean; safety: boolean; bubbleCap: 1 | 2 | 3 };
}

/** Answers each call with the next scripted reply, recording what the route sent. */
function script(replies: string[]): Sent[] {
  const sent: Sent[] = [];
  let turn = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push({ body: JSON.parse(String(init?.body ?? '{}')) });
    const content = replies[Math.min(turn++, replies.length - 1)];
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 9_412, completion_tokens: 186 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return sent;
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/try', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openrouter-key': 'sk-test' },
    body: JSON.stringify(body),
  });
}

async function say(text: string, state: TryState | undefined, now: number, files: Record<string, string> = {}) {
  const response = await tryPost(request({ files, text, state, history: [], tz: TZ, now }));
  expect(response.status).toBe(200);
  return (await response.json()) as Answer;
}

function reply(bubbles: string[], hook: HookKind | null, mood = 'content'): string {
  return JSON.stringify({
    confidence_level: 80,
    tool_calls: null,
    bubbles: bubbles.map(text => ({ text })),
    status: {
      mood_label: mood,
      mood_shift: 'steady',
      intent_mode: 'sharing_update',
      turn: 'share',
      hook_kind: hook,
      epistemic_trigger: 'none',
      meta_prompt: 'they are warming up',
    },
  });
}

function tailOf(sent: Sent): string {
  return sent.body.messages[sent.body.messages.length - 1].content;
}

const state = (turns = 0): TryState => ({
  ...initialAffect(NOW, TZ),
  turns,
  moodLabel: turns ? 'content' : '',
});

describe('TryRoom parity with IrisesWeb', () => {
  it('sends the tail the snapshot builds, byte for byte', async () => {
    const text = 'i got the job';
    const start = state(2);
    const sent = script([reply(['wait', 'tell me everything'], 'question')]);

    const answer = await say(text, start, NOW);
    const planned = planTurn({
      state: start,
      clock: computeClock(NOW, TZ),
      tz: TZ,
      text,
      lastCredit: false,
      now: NOW,
    });

    const tail = tailOf(sent[0]);
    expect(tail).toBe(asMeeting(vendorBuildTail(toVendorTail(planned.tail))));
    // And it is really a framed turn, not an empty string that happens to match.
    expect(tail.startsWith('<prompt>\n## Right now')).toBe(true);
    expect(tail).toContain(`<their_message>${text}</their_message>`);
    expect(tail).toContain('## Where you are right now (INTERNAL weather');
    expect(tail).toContain('## Still the same Irises, this far down');
    expect(tail.endsWith(jsonAnchor(answer.turn.bubbleCap))).toBe(true);
    expect(answer.usage).toEqual({ prompt: 9_412, completion: 186 });
  });

  it('uses the pack’s pools in the tail and the snapshot’s pools when it has none', async () => {
    const voice = [
      'export const SAMPLE_REPLIES: readonly (readonly string[])[] = [',
      "  ['pack-alpha'],",
      "  ['pack-beta'],",
      "  ['pack-gamma'],",
      "  ['pack-delta'],",
      "  ['pack-epsilon'],",
      "  ['pack-zeta'],",
      '];',
      'export const STRETCH_WORDS: readonly string[] = [',
      "  'pack-stretch-one', 'pack-stretch-two', 'pack-stretch-three', 'pack-stretch-four',",
      '];',
      'export const PUNCT_RUNS: readonly string[] = [',
      "  'pack-punct-one', 'pack-punct-two', 'pack-punct-three', 'pack-punct-four',",
      '];',
    ].join('\n');

    const files = { 'soul-pack/irises-web/src/worker/prompt/voice.ts': voice };

    const packedSent = script([reply(['hi'], 'question')]);
    await say('hello', state(1), NOW, files);
    const packed = tailOf(packedSent[0]);

    const plainSent = script([reply(['hi'], 'question')]);
    await say('hello', state(1), NOW);
    const plain = tailOf(plainSent[0]);

    const vendor = vendorVoiceSamples(Math.floor(NOW / 60_000));
    expect(packed).toContain('pack-alpha');
    expect(packed).toContain('pack-stretch-one');
    expect(packed).toContain('pack-punct-one');
    expect(packed).not.toContain(vendor.stretch);
    expect(plain).toContain(vendor.stretch);
    expect(plain).not.toContain('pack-alpha');
  });

  it('forces quiet after three hooked turns and renders the quiet law', async () => {
    const sent = script([reply(['a'], 'question'), reply(['b'], 'judgment'), reply(['c'], 'callback'), reply(['d'], 'question')]);

    let current: TryState | undefined;
    for (let turn = 0; turn < 3; turn++) current = (await say(`msg ${turn}`, current, NOW + turn * 60_000)).state;
    expect(current?.hookTrail).toEqual(['question', 'judgment', 'callback']);

    const fourth = await say('msg 3', current, NOW + 3 * 60_000);
    expect(fourth.turn.quietForced).toBe(true);

    const tail = tailOf(sent[3]);
    expect(tail).toContain('## This turn');
    expect(tail).toContain('Stay quiet this turn');
    expect(tail).toContain('You have been sharp three times running');
    expect(tail).toContain('No hook, no callback, no question');
  });

  it('renders the pieces block for a run of three', async () => {
    const text = '[msg 1] i got the job\n[msg 2] wait no\n[msg 3] i got the job!!';
    expect(runLength(text)).toBe(3);
    const sent = script([reply(['ok'], 'question')]);

    await say(text, state(1), NOW);

    expect(tailOf(sent[0])).toContain('## Their message came in pieces');
    expect(tailOf(sent[0])).toContain('They sent 3 bubbles in a row');
    expect(tailOf(sent[0])).toContain('<their_message>[msg 1] i got the job\n[msg 2] wait no');
  });

  it('switches to the careful law on a crisis message', async () => {
    const sent = script([reply(['hey'], null)]);
    const answer = await say('i want to die', state(1), NOW);

    expect(answer.turn.safety).toBe(true);
    const tail = tailOf(sent[0]);
    expect(tail).toContain('## Careful');
    expect(tail).toContain('They may be in real trouble');
    expect(tail).toContain('Find out what happened and whether they are safe right now');
    expect(tail).not.toContain('## This turn');
  });
});

describe('the state that rides between turns', () => {
  it('advances exactly as the page does, hook trail and all', async () => {
    const clock = computeClock(NOW, TZ);
    const start = state(1);
    const envelope = readEnvelope(reply(['wait'], 'judgment')) as Envelope;
    const page = await finishChatTurn({ envelope, state: start, clock, now: NOW, sid: 'sid', turn: 1, secret: 'secret' });

    expect(advanceTryState(start, envelope, clock, NOW)).toEqual(page.state);
  });

  it('brings a repeated hook_kind through the trail into the next tail', async () => {
    const envelope = readEnvelope(reply(['wait'], 'judgment')) as Envelope;
    const clock = computeClock(NOW, TZ);
    let current = state(0);
    for (let turn = 0; turn < 3; turn++) current = advanceTryState(current, envelope, clock, NOW + turn * 1_000);

    expect(current.hookTrail).toEqual(['judgment', 'judgment', 'judgment']);
    const planned = planTryTurn({ state: current, tz: TZ, text: 'again', nowMs: NOW + 3_000 });
    expect(planned.turn.quietForced).toBe(true);
    const tail = vendorBuildTail(toVendorTail(planned.tail));
    expect(tail).toContain('## This turn');
    expect(tail).toContain('You have been sharp three times running');

    // A reply that hands nothing back breaks the strike, so the next tail is general again.
    const flat = readEnvelope(reply(['ok'], null)) as Envelope;
    const broken = advanceTryState(current, flat, clock, NOW + 4_000);
    expect(broken.hookTrail).toEqual(['judgment', 'judgment', null]);
    const after = planTryTurn({ state: broken, tz: TZ, text: 'hey', nowMs: NOW + 5_000 });
    expect(after.turn.quietForced).toBe(false);
    expect(vendorBuildTail(toVendorTail(after.tail))).not.toContain('## This turn');
    expect(vendorBuildTail(toVendorTail(after.tail))).toContain('A task gets answered flat and first');
  });
});

describe('a scripted five-turn conversation', () => {
  it('frames every tail exactly as the page code does', async () => {
    const scripted = [
      reply(['wait', 'what happened'], 'question'),
      reply(['nooo', 'really??'], 'judgment'),
      reply(['ok', 'and then?'], 'callback'),
      reply(['hmm', 'tell me more'], 'tangent'),
      reply(['same', 'honestly'], 'question'),
    ];
    const texts = ['i got the job', 'wait no i mean the other one', 'ok so', 'and it starts monday', 'im scared tho'];
    const sent = script(scripted);

    // The page's own loop: planTurn for the tail, finishChatTurn for the state after.
    let pageState = initialAffect(NOW, TZ);
    const expected: string[] = [];

    let sentState: TryState | undefined;
    for (let turn = 0; turn < texts.length; turn++) {
      const now = NOW + turn * 60_000;
      const clock = computeClock(now, TZ);
      const planned = planTurn({ state: pageState, clock, tz: TZ, text: texts[turn], lastCredit: false, now });
      expected.push(asMeeting(vendorBuildTail(toVendorTail(planned.tail))));

      const answer = await say(texts[turn], sentState, now);
      sentState = answer.state;
      expect(answer.usage).toEqual({ prompt: 9_412, completion: 186 });

      const envelope = readEnvelope(scripted[turn]) as Envelope;
      pageState = (await finishChatTurn({ envelope, state: pageState, clock, now, sid: 'sid', turn, secret: 'secret' })).state;
    }

    expect(sent.map(tailOf)).toEqual(expected);
    expect(sentState).toEqual(pageState);
    expect(pageState.hookTrail).toEqual(['callback', 'tangent', 'question']);
    expect(pageState.turns).toBe(texts.length);
  });
});
