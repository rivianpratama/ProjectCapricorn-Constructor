import { complete, HttpError, keyFrom, MODELS, parseJson } from '../../../src/lib/openrouter';
import { buildTail } from '../../../src/lib/fidelity/tail';
import { webSystemPrompt } from '../../../src/lib/fidelity/irisesweb';

export const runtime = 'nodejs';

interface Body {
  files: Record<string, string>;
  text: string;
  history?: Array<{ role: 'them' | 'you'; text: string }>;
  clockLabel?: string;
  tz?: string;
  bubbleCap?: 1 | 2 | 3;
  seed?: number;
}

interface Reply {
  confidence_level?: number;
  bubbles?: Array<{ text?: string }>;
  status?: Record<string, unknown>;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const body = (await request.json()) as Body;
    if (!body?.text?.trim()) throw new HttpError(400, 'nothing to reply to');

    const system = webSystemPrompt(body.files ?? {});
    const tail = buildTail(
      {
        clockLabel: body.clockLabel ?? clockLabel(),
        tz: body.tz ?? 'Asia/Jakarta',
        directiveLines: ['mood even, mask on'],
        looseness: 2,
        bubbleCap: body.bubbleCap ?? 3,
        quietForced: false,
        safety: false,
        firstTurn: (body.history ?? []).length === 0,
        voiceSeed: body.seed ?? minuteOfDay(),
        text: body.text,
      },
      body.files ?? {},
    );

    const history = (body.history ?? []).map(turn => ({
      role: turn.role === 'them' ? ('user' as const) : ('assistant' as const),
      content: turn.text,
    }));

    const content = await complete({
      key,
      model: MODELS.strong,
      messages: [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: tail },
      ],
      temperature: 0.8,
      maxTokens: 2_000,
    });

    const reply = parseJson<Reply>(content);
    const bubbles = (reply.bubbles ?? [])
      .map(bubble => String(bubble?.text ?? '').trim())
      .filter(Boolean);
    if (!bubbles.length) throw new HttpError(502, 'the model sent no bubbles');
    return Response.json({ bubbles, status: reply.status ?? null, confidence: reply.confidence_level ?? null });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'try failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

function minuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function clockLabel(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
