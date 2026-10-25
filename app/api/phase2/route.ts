import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeLongForm, fitMessages, HttpError, keyFrom, modelsFrom } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { inheritanceRules } from '../../../src/lib/pipeline/rules';
import { parseReport, REPORT_SECTIONS } from '../../../src/lib/schema/report';
import { statsLines } from '../../../src/lib/pipeline/transcript';
import { splitSections } from '../../../src/lib/schema/markdown';
import type { Report } from '../../../src/lib/schema/report';
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

/** Enough room for six engrams plus the previous report in any current model's context. */
const REPAIR_CHARS = 600_000;

/** The report's sections, as the prompt names them; the retry message repeats them. */
const SECTIONS = [
  '# ENGRAM',
  ...REPORT_SECTIONS.map((name, i) => `## ${i + 1}. ${name}`),
].join('\n');

export async function POST(request: Request): Promise<Response> {
  return withLogging('phase2', handle)(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    const chats = body?.chats ?? [];
    if (chats.length < 1 || chats.length > 6) throw new HttpError(400, 'one to six chats');
    if (chats.some(chat => !chat?.engram || !chat?.stats)) throw new HttpError(400, 'every chat needs an engram and stats');

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

    const system = prompt('phase2');
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];
    let markdown = (
      await completeLongForm({ key, model: models.strong, messages, temperature: 0.4, maxTokens: 24_000 })
    ).content;

    let report: Report;
    try {
      report = parseReport(markdown);
    } catch (parseError) {
      // A report that parses wrong is one edit away from right; say what is wrong and to what shape.
      const problem = parseError instanceof Error ? parseError.message : 'the report did not parse';
      log.warn('report did not parse', {
        model: models.strong,
        why: problem,
        chars: markdown.length,
        headings: splitSections(markdown).sections.map(section => section.title).slice(0, 14),
      });
      const repair =
        `Your previous response failed validation: ${problem}.\n` +
        `Send the complete report again, with all 11 headings exactly as below and in this order:\n${SECTIONS}\n` +
        'Keep the content you already worked out. Output only the report, starting at the first heading.';
      // The transcript plus a 38k-character report can outgrow the window; trim the transcript body.
      const repairMessages = fitMessages(
        [...messages, { role: 'assistant' as const, content: markdown }, { role: 'user' as const, content: repair }],
        REPAIR_CHARS,
      );
      const repaired = (
        await completeLongForm({
          key,
          model: models.strong,
          messages: repairMessages,
          temperature: 0.2,
          maxTokens: 24_000,
        })
      ).content;
      markdown = repaired;
      try {
        report = parseReport(markdown);
      } catch (retryError) {
        const retryProblem = retryError instanceof Error ? retryError.message : 'the report did not parse';
        throw new HttpError(502, `${retryProblem} (after one retry)`);
      }
    }
    return Response.json({ markdown, report, rules });
  } catch (error) {
    return failed(error, 'phase 2 failed');
  }
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  }
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
