import { log } from './log';

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

export type ReasoningEffort = 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';

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
  return {
    cheap: pick('x-openrouter-model-cheap', MODELS.cheap),
    strong: pick('x-openrouter-model-strong', MODELS.strong),
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

  const text = await response.text();
  let parsed: CompletionResponse = {};
  try {
    parsed = JSON.parse(text) as CompletionResponse;
  } catch {
    if (!response.ok) return failed(new HttpError(response.status, shortError(text)));
    return failed(new HttpError(502, 'model returned unreadable output'));
  }
  if (!response.ok) return failed(new HttpError(response.status, shortError(parsed.error?.message ?? text)));
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
      log.info('retrying at minimal reasoning', { model: options.model ?? MODELS.strong, why: result.empty.reason });
      result = await requestCompletion({ ...options, reasoning: { effort: 'minimal' }, temperature: 0.2 });
    } catch (retryError) {
      // Keep the first result: it carries the useful diagnosis. The retry's own failure is worth a line.
      log.warn('minimal-reasoning retry failed', { model: options.model ?? MODELS.strong, error: retryError });
    }
  } else if (result.truncated) {
    try {
      log.info('retrying a cut-off answer', { model: options.model ?? MODELS.strong, why: result.truncated.reason });
      const retried = await requestCompletion({
        ...options,
        reasoning: reasoning ? { ...reasoning, effort: 'minimal' } : undefined,
        temperature: 0.2,
      });
      // Only the retry's diagnosis matters, never the original: that one was cut off by design.
      if (retried.empty) log.warn('cut-off retry came back empty', { model: options.model ?? MODELS.strong, why: retried.empty.reason });
      else if (!retried.truncated) result = retried;
    } catch (retryError) {
      log.warn('cut-off retry failed', { model: options.model ?? MODELS.strong, error: retryError });
    }
  }
  if (result.empty) throw new HttpError(502, `${options.model ?? MODELS.strong}: ${result.empty.reason}`);
  return result;
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
