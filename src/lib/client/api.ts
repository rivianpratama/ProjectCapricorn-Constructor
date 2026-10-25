export interface ModelChoice {
  cheap: string;
  strong: string;
}

export interface ApiError extends Error {
  /** The id the server logged this failure under, when the response carried one. */
  requestId?: string;
  status?: number;
}

export async function api<T>(path: string, key: string, body: unknown): Promise<T> {
  const models = modelStore.get();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-openrouter-key': key,
    'x-request-id': crypto.randomUUID().slice(0, 8),
  };
  if (models.cheap) headers['x-openrouter-model-cheap'] = models.cheap;
  if (models.strong) headers['x-openrouter-model-strong'] = models.strong;
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    // A network-level failure never reaches the server, so this line is the only trace.
    throw failure(path, undefined, 0, 'could not reach the server');
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!response.ok) throw failure(path, data.id, response.status, data.error || 'request failed');
  return data as T;
}

/** One place to build and report a failed call. The key never appears here. */
function failure(
  path: string,
  requestId: string | undefined,
  status: number,
  message: string,
  report = true,
): ApiError {
  const error = Object.assign(new Error(message), { requestId, status }) as ApiError;
  if (report) console.error(`[client] ${path} failed`, { status, requestId, message });
  return error;
}

const KEY = 'constructinator.key';
const REMEMBER = 'constructinator.remember';
const PACK = 'constructinator.pack';

export const keyStore = {
  get(): string {
    if (typeof window === 'undefined') return '';
    return window.sessionStorage.getItem(KEY) ?? window.localStorage.getItem(KEY) ?? '';
  },
  set(value: string, remember = false): void {
    if (typeof window === 'undefined') return;
    if (remember) {
      window.localStorage.setItem(KEY, value);
      window.localStorage.setItem(REMEMBER, 'yes');
      window.sessionStorage.removeItem(KEY);
    } else {
      if (value) window.sessionStorage.setItem(KEY, value);
      else window.sessionStorage.removeItem(KEY);
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(REMEMBER);
    }
  },
  remembered(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(REMEMBER) === 'yes';
  },
};

export const packStore = {
  set(files: Record<string, string>): void {
    window.sessionStorage.setItem(PACK, JSON.stringify(files));
  },
  get(): Record<string, string> | null {
    const raw = window.sessionStorage.getItem(PACK);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return null;
    }
  },
  clear(): void {
    window.sessionStorage.removeItem(PACK);
  },
};

const MODEL = 'constructinator.models';

/** The chosen OpenRouter models. An empty string means "use the server default". */
export const modelStore = {
  get(): ModelChoice {
    if (typeof window === 'undefined') return { cheap: '', strong: '' };
    try {
      const raw = JSON.parse(window.localStorage.getItem(MODEL) ?? '{}') as Partial<ModelChoice>;
      return { cheap: raw.cheap ?? '', strong: raw.strong ?? '' };
    } catch {
      return { cheap: '', strong: '' };
    }
  },
  set(value: ModelChoice): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODEL, JSON.stringify(value));
  },
};
