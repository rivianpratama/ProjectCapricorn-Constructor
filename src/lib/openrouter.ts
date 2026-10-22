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
const KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';

export const MODELS = {
  cheap: process.env.OPENROUTER_MODEL_CHEAP ?? 'google/gemini-2.5-flash',
  strong: process.env.OPENROUTER_MODEL_STRONG ?? 'anthropic/claude-sonnet-4.5',
};

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
