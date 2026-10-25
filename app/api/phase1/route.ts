import { currentRequestId, log, withLogging } from '../../../src/lib/log';
import { completeLongForm, HttpError, keyFrom, modelsFrom } from '../../../src/lib/openrouter';
import { prompt } from '../../../src/lib/prompts';
import { transcriptFor } from '../../../src/lib/pipeline/transcript';
import { parseEngramDetailed, type Engram, type FindingSummary } from '../../../src/lib/schema/engram';
import { verifyEvidence } from '../../../src/lib/pipeline/quotes';
import type { ChatStats, Message } from '../../../src/lib/chats/types';

export const runtime = 'nodejs';

export { isQuoteInTranscript } from '../../../src/lib/pipeline/quotes';

interface Body {
  chat: string;
  relationship: string;
  subject: string;
  messages: Message[];
  stats: ChatStats;
  chunk?: { index: number; count: number };
}

/** The finding shape from the evidence contract, repeated whenever the model has to try again. */
const FINDING_SHAPE =
  '- id: m09-tease, claim: ... , quotes: "verbatim quote of one subject message", msgs: #12, ' +
  'count: 5, frequency: often, scope: across topics, confidence: high';

export async function POST(request: Request): Promise<Response> {
  return withLogging('phase1', handle)(request);
}

async function handle(request: Request): Promise<Response> {
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

    let markdown = (
      await completeLongForm({
        key,
        model: models.cheap,
        messages: [
          { role: 'system', content: prompt('phase1') },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        maxTokens: 32_000,
      })
    ).content;

    let verdict = checked(markdown, body);
    if (verdict.problem) {
      // Say what is actually wrong, not "no findings": the model can fix a named mistake.
      log.warn('engram failed validation, repairing', {
        chat: body.chat,
        why: verdict.problem,
        rejected: verdict.findings.rejected.slice(0, 3),
        missingQuotes: verdict.missing.slice(0, 3),
      });
      const repaired = (
        await completeLongForm({
          key,
          model: models.cheap,
          messages: [
            { role: 'system', content: prompt('phase1') },
            { role: 'user', content: user },
            { role: 'assistant', content: markdown },
            { role: 'user', content: repairPrompt(verdict) },
          ],
          temperature: 0.2,
          maxTokens: 32_000,
        })
      ).content;
      markdown = repaired;
      verdict = checked(markdown, body);
      if (verdict.problem) throw new HttpError(502, `${verdict.problem} (after one retry)`);
    }

    const engram = verdict.engram;
    log.info('engram built', {
      chat: body.chat,
      chunk: body.chunk,
      messages: body.messages.length,
      findings: engram.findings.length,
      exemplars: engram.exemplars.length,
      chars: markdown.length,
    });
    return Response.json({ chat: body.chat, markdown, engram });
  } catch (error) {
    return failure(error);
  }
}

/** What the second attempt is told, built from what actually failed the first time. */
function repairPrompt(verdict: Verdict): string {
  const lines = [
    `Your previous response failed validation: ${verdict.problem}`,
    'Send the complete engram report again with all 11 numbered H2 headings (## 1. Context through ## 11. Gaps).',
    `Write every finding as one line exactly like this: ${FINDING_SHAPE}`,
    'Each quote must be the text of ONE subject message, copied exactly, short, and with no speaker label.',
  ];
  if (verdict.missing.length) {
    lines.push(`These quotes were not found in the transcript; replace each with a verbatim quote or drop the finding: ${verdict.missing.slice(0, 5).map(quote => `"${quote.slice(0, 60)}"`).join(', ')}`);
  }
  lines.push('Output the full Markdown report only, starting directly with "## 1. Context".');
  return lines.join('\n');
}

/**
 * Keeps the quotes the transcript proves and drops the rest. There is no ratio guard: the model
 * cannot fix a ratio, and a quote that is genuinely missing leaves a finding with no evidence,
 * which becomes a smaller honest engram instead of a failed build.
 */
export function assertEvidence(engram: Engram, messages: Message[]): { total: number; verified: number; missing: string[] } {
  const evidence = verifyEvidence(engram.findings, messages);
  engram.findings = engram.findings.filter(finding => finding.quotes.length > 0);
  return evidence;
}

/**
 * Why an engram cannot go on, or null when it can. `Not observed (searched: …)` answers a probe
 * on its own, so one receipt anywhere is enough to show the contract was followed: a short or
 * quiet chat honestly has fewer findings than probes, and a search-condensed fake contains no
 * real episodes at all.
 */
function problemOf(engram: Engram, findings: FindingSummary, evidence: { total: number; verified: number }): string | null {
  if (!engram.findings.length && !findings.receipts.length) {
    const written = findings.rejected.length;
    if (written) {
      const why = findings.rejected
        .slice(0, 3)
        .map(reject => `${reject.reason} ("${reject.line.slice(0, 80)}…")`)
        .join('; ');
      return `the engram carried no findings the parser could keep (${written} written): ${why}`;
    }
    if (evidence.total) {
      return `every quote in the engram was missing from the transcript (${evidence.verified}/${evidence.total} verified)`;
    }
    return 'the engram carried no tagged findings: no line followed the finding shape from the evidence contract';
  }
  if (!engram.sections['9. Context-specific (the overfit fence)']?.trim()) return 'the overfit fence is empty';
  return null;
}

interface Verdict {
  engram: Engram;
  findings: FindingSummary;
  missing: string[];
  problem: string | null;
}

/** Parse, verify the quotes, and decide whether the engram can go on. */
function checked(markdown: string, body: Body): Verdict {
  const { engram, findings } = parseEngramDetailed(markdown, body.chat);
  const evidence = assertEvidence(engram, body.messages);
  return { engram, findings, missing: evidence.missing, problem: problemOf(engram, findings, evidence) };
}

function failure(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, id: currentRequestId() }, { status: error.status });
  }
  log.error('phase 1 failed unexpectedly', { error });
  const message = error instanceof Error ? error.message : 'phase 1 failed';
  return Response.json({ error: message }, { status: 500 });
}
