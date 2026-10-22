import { complete, HttpError, keyFrom, modelsFrom } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { transcriptFor } from '../../../src/lib/pipeline/transcript';
import { parseEngram } from '../../../src/lib/schema/engram';
import type { ChatStats, Message } from '../../../src/lib/chats/types';

export const runtime = 'nodejs';

interface Body {
  chat: string;
  relationship: string;
  subject: string;
  messages: Message[];
  stats: ChatStats;
  chunk?: { index: number; count: number };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    if (!body?.messages?.length) throw new HttpError(400, 'no messages for this chat');

    const user = transcriptFor({
      label: body.chat,
      relationship: body.relationship,
      subject: body.subject,
      messages: body.messages,
      stats: body.stats,
      chunk: body.chunk,
    });

    const markdown = await complete({
      key,
      model: models.cheap,
      messages: [
        { role: 'system', content: prompt('phase1') },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      maxTokens: 32_000,
    });

    const engram = parseEngram(markdown, body.chat);
    assertEvidence(engram, body.messages);
    return Response.json({ chat: body.chat, markdown, engram });
  } catch (error) {
    return failure(error);
  }
}

function assertEvidence(engram: ReturnType<typeof parseEngram>, messages: Message[]): void {
  const transcript = messages.map(message => message.text).join('\n');
  if (!engram.findings.length) throw new HttpError(502, 'the engram carried no tagged findings');
  for (const finding of engram.findings) {
    for (const quote of finding.quotes) {
      if (!transcript.includes(quote)) throw new HttpError(502, `quote not found in the transcript: ${quote.slice(0, 60)}`);
    }
  }
  if (!engram.sections['9. Context-specific (the overfit fence)']?.trim()) {
    throw new HttpError(502, 'the overfit fence is empty');
  }
}

function failure(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : 'phase 1 failed';
  return Response.json({ error: message }, { status: 500 });
}
