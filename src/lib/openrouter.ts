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

const MODEL_ID = /^[A-Za-z0-9][\w.~:\-]*\/[\w.~:\-]+$/;

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

export interface ModelInfo {
  id: string;
  name: string;
  context: number;
  /** USD per million prompt tokens; null when OpenRouter does not say. */
  promptPrice: number | null;
  completionPrice: number | null;
}

export async function listModels(): Promise<ModelInfo[]> {
  let response: Response;
  try {
    response = await fetch(MODELS_ENDPOINT, { next: { revalidate: 600 } });
  } catch {
    throw new HttpError(502, 'could not reach openrouter');
  }
  if (!response.ok) throw new HttpError(response.status, 'model list failed');
  const data = (await response.json().catch(() => null)) as {
    data?: Array<{
      id?: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { output_modalities?: string[] };
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
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
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

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export async function complete(options: CompletionOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model ?? MODELS.strong,
    messages: options.messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 8192,
  };
  if (options.json) body.response_format = { type: 'json_object' };

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
  } catch {
    throw new HttpError(502, 'could not reach openrouter');
  }

  const text = await response.text();
  let parsed: CompletionResponse = {};
  try {
    parsed = JSON.parse(text) as CompletionResponse;
  } catch {
    if (!response.ok) throw new HttpError(response.status, shortError(text));
    throw new HttpError(502, 'model returned unreadable output');
  }
  if (!response.ok) throw new HttpError(response.status, shortError(parsed.error?.message ?? text));
  const content = parsed.choices?.[0]?.message?.content?.trim();
  if (!content) throw new HttpError(502, 'model returned nothing');
  return content;
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
    throw new HttpError(502, 'model returned invalid json');
  }
}
