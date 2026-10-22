import { complete, HttpError, keyFrom, modelsFrom, type Models, parseJson } from '../../../src/lib/openrouter';
import { webSystemPrompt } from '../../../src/lib/fidelity/irisesweb';
import { buildTail } from '../../../src/lib/fidelity/tail';
import { realIsFirst, scoreLikeness, scoreParroting, verdict, type LikenessJudgement } from '../../../src/lib/fidelity/score';

export const runtime = 'nodejs';

interface Body {
  files: Record<string, string>;
  drives: string[];
  pairs: Array<{ stimulus: string; reply: string[] }>;
  subjectMessages: string[];
  sketches: string[];
  /** Traits the owner removed, so pairs leaning on them are skipped. */
  removedTraits?: string[];
}

export async function POST(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    const pairs = (body.pairs ?? []).slice(0, 20);
    if (!pairs.length) throw new HttpError(400, 'no held-out pairs');

    const system = webSystemPrompt(body.files ?? {});
    const generated = await generate(key, models, system, body.files ?? {}, pairs);

    const judgements = await judgePairs(key, models, pairs, generated, body.removedTraits ?? []);
    const likeness = scoreLikeness(
      pairs.map(pair => ({ stimulus: pair.stimulus, real: pair.reply, generated: [] })),
      judgements,
    );
    const parroting = scoreParroting(generated, body.subjectMessages ?? []);
    const generalisation = await judgeSketches(key, models, body.drives ?? [], body.sketches ?? [], system);
    const outcome = verdict({ generalisation, parroting });

    return Response.json({ likeness, generalisation, parroting, verdict: outcome, generated });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'fidelity failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

async function generate(
  key: string,
  models: Models,
  system: string,
  files: Record<string, string>,
  pairs: Body['pairs'],
): Promise<string[][]> {
  const out: string[][] = new Array(pairs.length);
  const queue = pairs.map((pair, index) => ({ pair, index }));
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const tail = buildTail(
        {
          clockLabel: '20:00',
          tz: 'Asia/Jakarta',
          directiveLines: ['mood even, mask on'],
          looseness: 2,
          bubbleCap: 3,
          quietForced: false,
          safety: false,
          firstTurn: false,
          voiceSeed: next.index * 17 + 5,
          text: next.pair.stimulus,
        },
        files,
      );
      const content = await complete({
        key,
        model: models.cheap,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: tail },
        ],
        temperature: 0.8,
        maxTokens: 600,
      });
      const parsed = parseJson<{ bubbles?: Array<{ text?: string }> }>(content);
      out[next.index] = (parsed.bubbles ?? []).map(bubble => String(bubble?.text ?? '').trim()).filter(Boolean);
    }
  });
  await Promise.all(workers);
  return out;
}

async function judgePairs(
  key: string,
  models: Models,
  pairs: Body['pairs'],
  generated: string[][],
  removedTraits: string[],
): Promise<LikenessJudgement[]> {
  const lines = pairs.map((pair, i) => {
    const real = pair.reply.join(' / ');
    const made = generated[i].join(' / ') || '(nothing)';
    const first = realIsFirst(i) ? real : made;
    const second = realIsFirst(i) ? made : real;
    return [`Pair ${i + 1}`, `A: ${first}`, `B: ${second}`].join('\n');
  });

  const content = await complete({
    key,
    model: models.strong,
    json: true,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content: [
          'For each pair, one reply is the real person and one is a model. Decide which sounds like the real person.',
          'Rate both replies from one to five on voice, move choice and emotional fit.',
          'Mark skipped true when the pair leans on a trait the owner removed.',
          removedTraits.length ? `Traits the owner removed: ${removedTraits.join('; ')}` : 'The owner removed no traits.',
          'Return one entry per pair, in order.',
          '',
          'Shape',
          '{"pairs":[{"picked":"A","a":{"voice":4,"move":4,"emotion":3},"b":{"voice":3,"move":2,"emotion":2},"skipped":false}]}',
          '',
          ...lines,
        ].join('\n'),
      },
    ],
    temperature: 0.2,
    maxTokens: 5_000,
  });

  const parsed = parseJson<{
    pairs?: Array<{
      picked?: string;
      a?: { voice?: number; move?: number; emotion?: number };
      b?: { voice?: number; move?: number; emotion?: number };
      skipped?: boolean;
    }>;
  }>(content);

  return (parsed.pairs ?? []).slice(0, pairs.length).map((entry, i) => {
    const pickedA = String(entry.picked ?? 'A').trim().toUpperCase().startsWith('A');
    const realFirst = realIsFirst(i);
    const made = realFirst ? entry.b : entry.a;
    return {
      pickedReal: realFirst ? pickedA : !pickedA,
      voice: rating(made?.voice),
      move: rating(made?.move),
      emotion: rating(made?.emotion),
      skipped: Boolean(entry.skipped),
    };
  });
}

async function judgeSketches(key: string, models: Models, drives: string[], sketches: string[], system: string) {
  const content = await complete({
    key,
    model: models.strong,
    json: true,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content: [
          'The drives are below, then the persona. For each novel situation, say whether the persona would act from the named drive, without having seen the chats.',
          'Rate each 1 to 5 and list the numbers that fail.',
          '',
          '## Drives',
          ...drives,
          '',
          '## Persona',
          system.slice(0, 12_000),
          '',
          ...sketches.map((sketch, i) => `${i + 1}. ${sketch}`),
        ].join('\n'),
      },
    ],
    temperature: 0.2,
    maxTokens: 4_000,
  });

  const parsed = parseJson<{ scores?: number[]; missed?: number[] }>(content);
  const scores = (parsed.scores ?? []).map(rating).filter(score => score > 0);
  return {
    score: scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2)) : 0,
    judged: scores.length,
    missed: (parsed.missed ?? []).map(String),
  };
}

function rating(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.min(5, Math.max(1, Math.round(number)));
}

const JUDGE_SYSTEM = `You are judging whether a persona behaves like a real person, not whether it is polite or accurate.

Rate only behaviour: voice, the move chosen, and emotional fit. A reply that copies the person's old lines is a failure, not a success. A reply that acts from the person's needs and fears in a situation they never saw is a success.

Return JSON only. Never explain.`;
