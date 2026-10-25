import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeDetailed, HttpError, keyFrom, modelsFrom } from '../../../src/lib/openrouter';
import { webSystemPrompt } from '../../../src/lib/fidelity/irisesweb';
import {
  advanceTryState,
  buildTryTail,
  createTryState,
  planTryTurn,
  readEnvelope,
  type TryState,
} from '../../../src/lib/fidelity/tryloop';

export const runtime = 'nodejs';

interface Body {
  files: Record<string, string>;
  text: string;
  /** The state the last reply left behind, as the client stored it. */
  state?: TryState;
  history?: Array<{ role: 'them' | 'you'; text: string }>;
  tz?: string;
  /** Fixed clock, so a test can script a conversation. Defaults to now. */
  now?: number;
}

export async function POST(request: Request): Promise<Response> {
  return withLogging('try', handle)(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, 'nothing to reply to');

    const files = body.files ?? {};
    const tz = body.tz ?? 'Asia/Jakarta';
    const nowMs = Number.isFinite(body.now) ? Number(body.now) : Date.now();
    const state = isTryState(body.state) ? body.state : createTryState(nowMs, tz);

    const plan = planTryTurn({ state, tz, text, nowMs });
    const tail = buildTryTail(plan, files);

    const history = (body.history ?? [])
      .filter(turn => typeof turn?.text === 'string' && turn.text)
      .map(turn => ({
        role: turn.role === 'them' ? ('user' as const) : ('assistant' as const),
        content: turn.text,
      }));

    const { content, usage } = await completeDetailed({
      key,
      model: models.strong,
      messages: [
        { role: 'system', content: webSystemPrompt(files) },
        ...history,
        { role: 'user', content: tail },
      ],
      temperature: 0.8,
      maxTokens: 2_000,
    });

    const envelope = readEnvelope(content);
    if (!envelope) throw new HttpError(502, 'the model sent no reply');

    return Response.json({
      bubbles: envelope.bubbles.map(bubble => bubble.text),
      status: envelope.status,
      state: advanceTryState(state, envelope, plan.clock, nowMs),
      turn: plan.turn,
      usage,
    });
  } catch (error) {
    return failed(error, 'try failed');
  }
}

/** A state from an older page load or a hand-rolled request is thrown away, never trusted. */
function isTryState(value: unknown): value is TryState {
  const state = value as TryState | undefined;
  return (
    !!state &&
    typeof state === 'object' &&
    !!state.gauges &&
    typeof state.gauges === 'object' &&
    Array.isArray(state.hookTrail) &&
    Array.isArray(state.moves)
  );
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
