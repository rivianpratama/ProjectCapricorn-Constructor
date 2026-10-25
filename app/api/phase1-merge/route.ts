import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeLongForm, HttpError, keyFrom, modelsFrom } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { parseEngramDetailed, type Engram, type FindingSummary } from '../../../src/lib/schema/engram';

export const runtime = 'nodejs';

interface Body {
  chat: string;
  engrams: string[];
}

const HEADINGS =
  '## 1. Context\n## 2. Surface (L3)\n## 3. Moves (L2)\n## 4. Emotion\n## 5. Core (L1) hypotheses\n' +
  '## 6. Stances and tastes\n## 7. Shadow\n## 8. Drift\n## 9. Context-specific (the overfit fence)\n' +
  '## 10. Exemplars\n## 11. Gaps';

export async function POST(request: Request): Promise<Response> {
  return withLogging('phase1-merge', handle)(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    const key = keyFrom(request);
    const models = modelsFrom(request);
    const body = (await request.json()) as Body;
    if (!body?.engrams?.length) throw new HttpError(400, 'no chunk engrams');

    const user = [
      `Chat label: ${body.chat}`,
      `Chunks: ${body.engrams.length}`,
      '',
      ...body.engrams.flatMap((engram, i) => [`## Chunk ${i + 1}`, '', engram, '']),
    ].join('\n');
    const messages = [
      { role: 'system' as const, content: prompt('phase1-merge') },
      { role: 'user' as const, content: user },
    ];

    let markdown = (await completeLongForm({ key, model: models.cheap, messages, temperature: 0.2, maxTokens: 24_000 })).content;

    let verdict = checked(markdown, body.chat);
    if (verdict.problem) {
      // The merge is the one call that must not invent: name what survived and why the rest did not.
      log.warn('merged engram failed validation, repairing', {
        chat: body.chat,
        why: verdict.problem,
        rejected: verdict.findings.rejected.slice(0, 3),
      });
      const repair =
        `Your previous response failed validation: ${verdict.problem}\n` +
        `Output the complete merged engram report now in Markdown with these headings:\n${HEADINGS}\n` +
        'Keep every finding line exactly as a chunk wrote it, with its quotes unchanged; never add a finding no chunk has.';
      markdown = (
        await completeLongForm({
          key,
          model: models.cheap,
          messages: [...messages, { role: 'assistant' as const, content: markdown }, { role: 'user' as const, content: repair }],
          temperature: 0.2,
          maxTokens: 24_000,
        })
      ).content;
      verdict = checked(markdown, body.chat);
      if (verdict.problem) throw new HttpError(502, `${verdict.problem} (after one retry)`);
    }

    return Response.json({ markdown, engram: verdict.engram });
  } catch (error) {
    return failed(error, 'merge failed');
  }
}

/**
 * A merged engram goes on when it kept findings, or marked every probe Not observed with a
 * receipt. Quotes cannot be checked here (the transcript is not on this side), but a merge with
 * no findings at all would make Phase 2 write a ledger out of nothing.
 */
function checked(markdown: string, chat: string): { engram: Engram; findings: FindingSummary; problem: string | null } {
  const { engram, findings: summary } = parseEngramDetailed(markdown, chat);
  const fence = engram.sections['9. Context-specific (the overfit fence)'];
  if (!engram.findings.length && !summary.receipts.length) {
    const written = summary.rejected.length;
    const why = written
      ? `the parser could not keep ${written} finding line${written === 1 ? '' : 's'}: ${summary.rejected
          .slice(0, 3)
          .map(reject => `${reject.reason} ("${reject.line.slice(0, 60)}…")`)
          .join('; ')}`
      : 'no line followed the finding shape';
    return { engram, findings: summary, problem: `the merged engram carried no findings: ${why}` };
  }
  if (!engram.findings.length && fence !== undefined && !fence.trim()) {
    return { engram, findings: summary, problem: 'the overfit fence is empty' };
  }
  return { engram, findings: summary, problem: null };
}

/** Unexpected throws are logged with their stack; deliberate ones are not. */
function failed(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  log.error('unexpected failure', { error, fallback });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
