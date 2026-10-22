export async function api<T>(path: string, key: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openrouter-key': key },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'request failed');
  return data as T;
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
