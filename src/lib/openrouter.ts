import { isEffort, type ReasoningEffort } from './effort';
import { isStreaming, log, nextCall, streamEvent } from './log';

export type { ReasoningEffort };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  key: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** OpenRouter's unified reasoning control. Undefined leaves the model's default alone. */
  reasoning?: ReasoningOptions;
}

export interface ReasoningOptions {
  effort?: ReasoningEffort;
  max_tokens?: number;
  exclude?: boolean;
  enabled?: boolean;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';

export interface Models {
  /** Bulk work: per-chat engrams, merges, fidelity generation. */
  cheap: string;
  /** Synthesis and judging: report, questions, soul, try room. */
  strong: string;
  /** Reasoning effort the user picked per role. Absent means the model's own default. */
  effort?: Partial<Record<Role, ReasoningEffort>>;
}

export type Role = 'cheap' | 'strong';

/** The model and reasoning setting for one role, ready to spread into a completion call. */
export function forRole(models: Models, role: Role): { model: string; reasoning?: ReasoningOptions } {
  const effort = models.effort?.[role];
  return effort ? { model: models[role], reasoning: { effort } } : { model: models[role] };
}

export const MODELS: Models = {
  cheap: process.env.OPENROUTER_MODEL_CHEAP ?? 'google/gemini-2.5-flash',
  strong: process.env.OPENROUTER_MODEL_STRONG ?? 'anthropic/claude-sonnet-4.5',
};

const MODEL_ID = /^[\w.~:\-]+\/[\w.~:\-]+$/;

/** Models picked in the UI ride along as headers; absent or malformed ones fall back to the defaults. */
export function modelsFrom(request: Request): Models {
  const pick = (name: string, fallback: string): string => {
    const value = request.headers.get(name)?.trim();
    return value && MODEL_ID.test(value) ? value : fallback;
  };
  const effortOf = (name: string): ReasoningEffort | undefined => {
    const value = request.headers.get(name)?.trim().toLowerCase();
    return isEffort(value) ? value : undefined;
  };
  const cheap = effortOf('x-openrouter-effort-cheap');
  const strong = effortOf('x-openrouter-effort-strong');
  return {
    cheap: pick('x-openrouter-model-cheap', MODELS.cheap),
    strong: pick('x-openrouter-model-strong', MODELS.strong),
    ...(cheap || strong ? { effort: { ...(cheap ? { cheap } : {}), ...(strong ? { strong } : {}) } } : {}),
  };
}

export interface ModelReasoning {
  supported_efforts?: string[] | null;
  default_effort?: string;
  default_enabled?: boolean;
  mandatory?: boolean;
  supports_max_tokens?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  context: number;
  /** USD per million prompt tokens; null when OpenRouter does not say. */
  promptPrice: number | null;
  completionPrice: number | null;
  /** Present when the model exposes reasoning controls. */
  reasoning?: ModelReasoning;
}

export async function listModels(): Promise<ModelInfo[]> {
  let response: Response;
  try {
    response = await fetch(MODELS_ENDPOINT, { next: { revalidate: 600 } });
  } catch (error) {
    log.warn('model list unreachable', { error });
    throw new HttpError(502, 'could not reach openrouter');
  }
  if (!response.ok) {
    log.warn('model list refused', { status: response.status });
    throw new HttpError(response.status, 'model list failed');
  }
  const data = (await response.json().catch(() => null)) as {
    data?: Array<{
      id?: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { output_modalities?: string[] };
      reasoning?: {
        supported_efforts?: string[] | null;
        default_effort?: string;
        default_enabled?: boolean;
        mandatory?: boolean;
        supports_max_tokens?: boolean;
      };
    }>;
  } | null;
  const perMillion = (value?: string): number | null => {
    const n = Number(value);
    return value !== undefined && Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null;
  };
  return (data?.data ?? [])
    .filter(model => model.id && (!model.architecture?.output_modalities || model.architecture.output_modalities.includes('text')))
    .map(model => ({
      id: model.id as string,
      name: model.name || (model.id as string),
      context: model.context_length ?? 0,
      promptPrice: perMillion(model.pricing?.prompt),
      completionPrice: perMillion(model.pricing?.completion),
      reasoning: model.reasoning
        ? {
            supported_efforts: Array.isArray(model.reasoning.supported_efforts)
              ? model.reasoning.supported_efforts.filter((value): value is string => typeof value === 'string')
              : null,
            default_effort: typeof model.reasoning.default_effort === 'string' ? model.reasoning.default_effort : undefined,
            default_enabled: model.reasoning.default_enabled === true,
            mandatory: model.reasoning.mandatory === true,
            supports_max_tokens: model.reasoning.supports_max_tokens === true,
          }
        : undefined,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const EFFORT_PREFERENCE: ReasoningEffort[] = ['low', 'minimal', 'medium', 'high', 'xhigh', 'max'];

/**
 * A reasoning budget that leaves room for the answer, but only for models that
 * think by default. Undefined means "send no reasoning field at all", which is
 * what every non-reasoning model and every opt-in reasoning model expects.
 */
export async function reasoningFor(model: string): Promise<ReasoningOptions | undefined> {
  try {
    const info = (await listModels()).find(entry => entry.id === model);
    const meta = info?.reasoning;
    if (!meta || (!meta.mandatory && !meta.default_enabled)) return undefined;
    const supported = meta.supported_efforts ?? [];
    const effort = EFFORT_PREFERENCE.find(value => supported.includes(value)) ?? 'low';
    return { effort };
  } catch (error) {
    // No reasoning cap means a thinking model may spend the whole budget; say why.
    log.warn('could not read model reasoning metadata', { model, error });
    return undefined;
  }
}

/**
 * The least reasoning a model will actually accept, for the retry after reasoning ate the budget.
 * 'minimal' is not in every model's vocabulary (DeepSeek offers max/high/low/none and folds the
 * rest into high), so a blind 'minimal' can leave the model thinking just as hard. A model that
 * does not require reasoning is switched off; one that does gets its smallest listed effort.
 */
export async function reasoningFloor(model: string): Promise<ReasoningOptions> {
  try {
    const meta = (await listModels()).find(entry => entry.id === model)?.reasoning;
    const supported = meta?.supported_efforts ?? [];
    if (meta && !meta.mandatory && supported.includes('none')) return { effort: 'none' };
    const floor = (['minimal', 'low', 'medium'] as ReasoningEffort[]).find(value => supported.includes(value));
    if (floor) return { effort: floor };
  } catch (error) {
    log.warn('could not read model reasoning metadata', { model, error });
  }
  return { effort: 'minimal' };
}

export function keyFrom(request: Request): string {
  const key = request.headers.get('x-openrouter-key')?.trim();
  if (!key) throw new HttpError(401, 'missing key');
  return key;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface CompletionContentPart {
  text?: string;
}

interface CompletionChoice {
  message?: {
    content?: string | CompletionContentPart[] | null;
    reasoning?: string | null;
    refusal?: string | null;
  };
  finish_reason?: string | null;
  native_finish_reason?: string | null;
}

interface CompletionResponse {
  choices?: CompletionChoice[];
  error?: { message?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** What a call cost, for the token meter (PLAN §9.4). */
export interface Usage {
  prompt: number;
  completion: number;
}

const ZERO_USAGE: Usage = { prompt: 0, completion: 0 };

export interface Detailed {
  content: string;
  usage: Usage;
  finishReason: string;
  /** Visible completion tokens are `usage.completion` minus this. */
  reasoningTokens: number;
  /** Why the message carried no content. Set only when content is empty. */
  empty?: { reason: string; retryable: boolean };
  /** Set when the answer itself stops at the output limit: it is a document that ends mid-way. */
  truncated?: { reason: string };
}

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

export function usageOf(body: CompletionResponse): Usage {
  return {
    prompt: tokens(body.usage?.prompt_tokens),
    completion: tokens(body.usage?.completion_tokens),
  };
}

function contentOf(message: CompletionChoice['message']): string {
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/** A 200 with empty content is usually reasoning eating the output budget; name the actual cause. */
function emptyOf(input: {
  choices: number;
  finishReason: string;
  reasoningTokens: number;
  completionTokens: number;
  reasoning: string;
  refusal: string;
}): { reason: string; retryable: boolean } {
  if (input.refusal) return { reason: `the model refused: ${shortError(input.refusal)}`, retryable: false };
  if (input.finishReason === 'content_filter') return { reason: 'the provider filtered the response', retryable: false };
  if (!input.choices) return { reason: 'openrouter returned no choices', retryable: true };
  if (input.finishReason === 'length' && input.reasoningTokens > 0) {
    return {
      reason: `the model spent its whole output budget on reasoning (${input.reasoningTokens} of ${input.completionTokens} tokens); cap reasoning or raise max_tokens`,
      retryable: true,
    };
  }
  if (input.finishReason === 'length') {
    return {
      reason: `the model hit the output limit before writing an answer (${input.completionTokens} tokens); raise max_tokens`,
      retryable: true,
    };
  }
  if (input.reasoning) return { reason: 'the model returned reasoning but no answer', retryable: true };
  return { reason: 'model returned nothing', retryable: true };
}

/**
 * One OpenRouter call. Empty content comes back as `empty` instead of throwing,
 * so a long-form caller can retry with a smaller reasoning budget.
 */
export async function requestCompletion(options: CompletionOptions): Promise<Detailed> {
  const body: Record<string, unknown> = {
    model: options.model ?? MODELS.strong,
    messages: options.messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 8192,
    usage: { include: true },
  };
  if (options.json) body.response_format = { type: 'json_object' };
  if (options.reasoning) body.reasoning = options.reasoning;
  // A streamed request shows the model working. The assembled result is the same either way.
  const streaming = isStreaming();
  if (streaming) body.stream = true;
  const call = streaming ? nextCall() : 0;

  // The model, its role and what we sent; never the key or the prompts themselves.
  const context = {
    model: String(body.model),
    maxOutputTokens: body.max_tokens,
    temperature: body.temperature,
    reasoning: body.reasoning,
    promptChars: options.messages.reduce((sum, message) => sum + message.content.length, 0),
    messages: options.messages.length,
  };
  const started = performance.now();
  const failed = (error: unknown): never => {
    log.warn('completion failed', { ...context, ms: Math.round(performance.now() - started), error });
    throw error;
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.key}`,
        'content-type': 'application/json',
        'x-title': 'Constructinator',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return failed(new HttpError(502, 'could not reach openrouter'));
  }

  let parsed: CompletionResponse = {};
  if (streaming && response.ok && response.body) {
    streamEvent({ type: 'start', call, model: String(body.model), effort: options.reasoning?.effort });
    try {
      parsed = await readStream(response.body, call);
    } catch (error) {
      streamEvent({ type: 'end', call, ms: Math.round(performance.now() - started), error: 'the stream broke' });
      return failed(error instanceof HttpError ? error : new HttpError(502, 'the stream from openrouter broke'));
    }
    streamEvent({
      type: 'end',
      call,
      ms: Math.round(performance.now() - started),
      completion: tokens(parsed.usage?.completion_tokens),
      reasoning: tokens(parsed.usage?.completion_tokens_details?.reasoning_tokens),
      finish: parsed.choices?.[0]?.finish_reason ?? undefined,
      error: parsed.error?.message ? shortError(parsed.error.message) : undefined,
    });
  } else {
    const text = await response.text();
    try {
      parsed = JSON.parse(text) as CompletionResponse;
    } catch {
      if (!response.ok) return failed(new HttpError(response.status, shortError(text)));
      return failed(new HttpError(502, 'model returned unreadable output'));
    }
    if (!response.ok) return failed(new HttpError(response.status, shortError(parsed.error?.message ?? text)));
  }
  if (parsed.error?.message) return failed(new HttpError(502, shortError(parsed.error.message)));

  const choices = parsed.choices ?? [];
  const choice = choices[0];
  const usage = parsed.usage ? usageOf(parsed) : ZERO_USAGE;
  const detailed: Detailed = {
    content: contentOf(choice?.message),
    usage,
    finishReason: (choice?.finish_reason ?? choice?.native_finish_reason ?? '').toString(),
    reasoningTokens: tokens(parsed.usage?.completion_tokens_details?.reasoning_tokens),
  };

  log.debug('completion done', {
    ...context,
    ms: Math.round(performance.now() - started),
    finishReason: detailed.finishReason,
    promptTokens: usage.prompt,
    completionTokens: usage.completion,
    reasoningTokens: detailed.reasoningTokens,
    contentChars: detailed.content.length,
  });

  if (detailed.content && detailed.finishReason === 'length') {
    detailed.truncated = {
      reason: `the answer hit the output limit (${usage.completion} tokens${detailed.reasoningTokens ? `, ${detailed.reasoningTokens} of them reasoning` : ''}); raise max_tokens`,
    };
    log.warn('completion was cut off', {
      ...context,
      ms: Math.round(performance.now() - started),
      finishReason: detailed.finishReason,
      completionTokens: usage.completion,
      reasoningTokens: detailed.reasoningTokens,
      contentChars: detailed.content.length,
    });
  }

  if (!detailed.content) {
    detailed.empty = emptyOf({
      choices: choices.length,
      finishReason: detailed.finishReason,
      reasoningTokens: detailed.reasoningTokens,
      completionTokens: usage.completion,
      reasoning: typeof choice?.message?.reasoning === 'string' ? choice.message.reasoning.trim() : '',
      refusal: typeof choice?.message?.refusal === 'string' ? choice.message.refusal.trim() : '',
    });
    // A 200 that carries no answer is the failure mode that costs the most: it hides in a retry.
    log.warn('completion came back empty', {
      ...context,
      ms: Math.round(performance.now() - started),
      finishReason: detailed.finishReason,
      reasoningTokens: detailed.reasoningTokens,
      completionTokens: usage.completion,
      reason: detailed.empty.reason,
      retryable: detailed.empty.retryable,
    });
  }
  return detailed;
}

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; reasoning?: string | null; refusal?: string | null };
    finish_reason?: string | null;
    native_finish_reason?: string | null;
  }>;
  usage?: CompletionResponse['usage'];
  error?: { message?: string };
}

/**
 * Reads OpenRouter's server-sent events and forwards each piece to the browser as it arrives.
 * What comes back has the shape of a plain completion, so one code path judges both.
 */
async function readStream(stream: ReadableStream<Uint8Array>, call: number): Promise<CompletionResponse> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let refusal = '';
  let finish: string | undefined;
  let native: string | undefined;
  let usage: CompletionResponse['usage'];
  let error: string | undefined;

  const line = (raw: string): void => {
    // Comment lines (": OPENROUTER PROCESSING") keep the connection warm and carry nothing.
    if (!raw.startsWith('data:')) return;
    const data = raw.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      return;
    }
    if (chunk.error?.message) error = chunk.error.message;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    if (choice.native_finish_reason) native = choice.native_finish_reason;
    const delta = choice.delta;
    if (typeof delta?.reasoning === 'string' && delta.reasoning) {
      reasoning += delta.reasoning;
      streamEvent({ type: 'reasoning', call, text: delta.reasoning });
    }
    if (typeof delta?.content === 'string' && delta.content) {
      content += delta.content;
      streamEvent({ type: 'answer', call, text: delta.content });
    }
    if (typeof delta?.refusal === 'string') refusal += delta.refusal;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      line(buffer.slice(0, at).replace(/\r$/, ''));
      buffer = buffer.slice(at + 1);
    }
    if (done) break;
  }
  if (buffer) line(buffer.replace(/\r$/, ''));

  return {
    choices: [
      {
        message: { content, reasoning: reasoning || null, refusal: refusal || null },
        finish_reason: finish ?? null,
        native_finish_reason: native ?? null,
      },
    ],
    usage,
    ...(error ? { error: { message: error } } : {}),
  };
}

/** `complete`, plus the token counts the Try room prints under each reply. */
export async function completeDetailed(options: CompletionOptions): Promise<Detailed> {
  const result = await requestCompletion(options);
  if (result.empty) throw new HttpError(502, `${options.model ?? MODELS.strong}: ${result.empty.reason}`);
  return result;
}

/**
 * A long-form completion with room for the answer. Models that reason by
 * default get a smaller thinking budget; if one still returns no content, the
 * call is retried once at the smallest effort before giving up. An answer that
 * stops at the output limit is cut off, not failed, so it is retried once too:
 * a document that ends mid-section is worse than one call of wasted money.
 */
/**
 * A retry that carries the previous answer and the transcript can outgrow the model's window.
 * This trims the middle of the longest message so the call still fits: the start (the task) and
 * the end (the latest words) are what a repair needs most. One pass, and the result always fits.
 */
export function fitMessages(messages: ChatMessage[], budgetChars: number): ChatMessage[] {
  const total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total <= budgetChars) return messages;
  const room = Math.max(budgetChars - (total - Math.max(...messages.map(message => message.content.length))), 0);
  const longest = messages.reduce((best, message) => (message.content.length > best.content.length ? message : best));
  const content = longest.content;
  if (room < 4_000 || content.length <= room) return messages;
  const NOTE = '[... the middle is omitted to fit the model context; the start and the end are complete ...]';
  const keep = room - NOTE.length - 4;
  if (keep < 3_000) return messages;
  const head = Math.floor(keep * 0.6);
  const cut = `${content.slice(0, head)}\n\n${NOTE}\n\n${content.slice(content.length - (keep - head))}`;
  return messages.map((message, index) => (message === longest ? { ...message, content: cut } : message));
}

export async function completeLongForm(options: CompletionOptions): Promise<Detailed> {
  const reasoning = options.reasoning ?? (await reasoningFor(options.model ?? MODELS.strong));
  let result = await requestCompletion({ ...options, reasoning });
  if (result.empty?.retryable) {
    try {
      const floor = await reasoningFloor(options.model ?? MODELS.strong);
      log.info('retrying at minimal reasoning', { model: options.model ?? MODELS.strong, effort: floor.effort, why: result.empty.reason });
      result = await requestCompletion({ ...options, reasoning: floor, temperature: 0.2 });
    } catch (retryError) {
      // Keep the first result: it carries the useful diagnosis. The retry's own failure is worth a line.
      log.warn('minimal-reasoning retry failed', { model: options.model ?? MODELS.strong, error: retryError });
    }
  } else if (result.truncated) {
    result = await continueCutOff(options, result);
  }
  if (result.empty) throw new HttpError(502, `${options.model ?? MODELS.strong}: ${result.empty.reason}`);
  return result;
}

/** How many times a cut-off answer is resumed before it is returned as it stands. */
export const MAX_CONTINUATIONS = 3;

const CONTINUE = [
  'Your answer was cut off by the output limit. Continue it from exactly where it stopped, mid-word or',
  'mid-sentence if that is where it ended. Do not repeat anything already written, do not restart, and add no',
  'preamble: your reply is pasted straight onto the end of the text above.',
].join(' ');

/**
 * Resume a cut-off answer instead of regenerating it: the text so far goes back as the assistant turn and
 * the model writes only the rest, at its lowest reasoning, since the thinking was done the first time. Each
 * piece is appended (minus any overlap the model repeats), so no generated token is thrown away.
 */
async function continueCutOff(options: CompletionOptions, first: Detailed): Promise<Detailed> {
  const model = options.model ?? MODELS.strong;
  let result = first;
  for (let round = 0; round < MAX_CONTINUATIONS && result.truncated; round++) {
    try {
      log.info('continuing a cut-off answer', { model, round: round + 1, contentChars: result.content.length, why: result.truncated.reason });
      const next = await requestCompletion({
        ...options,
        messages: [...options.messages, { role: 'assistant', content: result.content }, { role: 'user', content: CONTINUE }],
        reasoning: options.reasoning || first.reasoningTokens ? await reasoningFloor(model) : undefined,
        temperature: Math.min(options.temperature ?? 0.4, 0.4),
      });
      if (next.empty) {
        log.warn('continuation came back empty', { model, why: next.empty.reason });
        break;
      }
      result = {
        ...next,
        content: joinContinuation(result.content, next.content),
        usage: { prompt: result.usage.prompt + next.usage.prompt, completion: result.usage.completion + next.usage.completion },
        reasoningTokens: result.reasoningTokens + next.reasoningTokens,
      };
    } catch (error) {
      log.warn('continuation failed; keeping the answer so far', { model, error });
      break;
    }
  }
  return result;
}

/**
 * Stitch a continuation onto the text it continues. A model often restates the last line or two before
 * going on, so the longest overlap between the tail and the start of the piece is dropped.
 */
export function joinContinuation(head: string, piece: string): string {
  const tail = head.slice(-2000);
  for (let size = Math.min(tail.length, piece.length); size >= 12; size--) {
    if (tail.endsWith(piece.slice(0, size))) return head + piece.slice(size);
  }
  // A restated last line that the cut had left half-written ("half a rep" then "half a report, ...").
  const line = head.slice(head.lastIndexOf('\n') + 1);
  if (line.trim().length >= 8 && piece.startsWith(line)) return head.slice(0, head.length - line.length) + piece;
  // Content arrives trimmed, so a cut that fell on a space or a line break lost it.
  if (/^[#*>-]|^```|^\d+\./.test(piece)) return `${head}\n${piece}`;
  if (/[.,;:!?)\]]$/.test(head) && /^[\p{L}\p{N}(]/u.test(piece)) return `${head} ${piece}`;
  return head + piece;
}

export async function complete(options: CompletionOptions): Promise<string> {
  return (await completeDetailed(options)).content;
}

export async function validateKey(key: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(KEY_ENDPOINT, {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
  } catch {
    throw new HttpError(502, 'could not reach openrouter');
  }
  if (response.status === 401) throw new HttpError(401, 'key rejected');
  if (!response.ok) throw new HttpError(response.status, 'key check failed');
}

function shortError(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim();
  return line.length > 160 ? `${line.slice(0, 157)}...` : line || 'request failed';
}

export function parseJson<T>(content: string): T {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    log.warn('model returned invalid json', { chars: content.length, head: cleaned.slice(0, 120) });
    throw new HttpError(502, 'model returned invalid json');
  }
}
