import { complete, HttpError, keyFrom, modelsFrom } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { inheritanceRules } from '../../../src/lib/pipeline/rules';
import { parseReport } from '../../../src/lib/schema/report';
import { statsLines } from '../../../src/lib/pipeline/transcript';
import type { ChatStats } from '../../../src/lib/chats/types';

export const runtime = 'nodejs';

interface ChatSummary {
  chat: string;
  relationship: string;
  subject: string;
  engram: string;
  stats: ChatStats;
}

interface Body {
  chats: ChatSummary[];
}

export async function POST(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    const chats = body?.chats ?? [];
    if (chats.length < 1 || chats.length > 6) throw new HttpError(400, 'one to six chats');

    const relationships = [...new Set(chats.map(chat => chat.relationship))];
    const rules = inheritanceRules(chats.length, relationships.length);
    const user = [
      `N = ${chats.length}`,
      `Relationships present: ${relationships.join(', ')}`,
      `Threshold for dominant: ${rules.threshold} of ${chats.length} chats`,
      `Per-chat evidence cap: ${Math.round(rules.cap * 100)}%`,
      `Slices: ${rules.slices ? 'yes, each chat splits into early, middle and late' : 'no'}`,
      rules.note,
      '',
      'Sources are labelled `chat-1` to `chat-' + chats.length + '`' + (rules.slices ? ', and slices as `chat-1 early`, `chat-1 middle`, `chat-1 late`.' : '.'),
      '',
      ...chats.flatMap((chat, i) => [
        `## chat-${i + 1}`,
        `relationship: ${chat.relationship}`,
        `subject: ${chat.subject}`,
        '',
        'Stats:',
        statsLines(chat.stats),
        '',
        chat.engram,
        '',
      ]),
    ].join('\n');

    const markdown = await complete({
      key,
      model: models.strong,
      messages: [
        { role: 'system', content: prompt('phase2') },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      maxTokens: 24_000,
    });

    const report = parseReport(markdown);
    return Response.json({ markdown, report, rules });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'phase 2 failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
