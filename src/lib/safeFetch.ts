export interface SafeJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
  isJson: boolean;
}

/**
 * Reads an HTTP Response safely without ever throwing
 * "SyntaxError: Failed to execute 'json' on 'Response': Unexpected end of JSON input".
 */
export async function safeReadJson<T>(res: Response): Promise<SafeJsonResult<T>> {
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    return { ok: false, status: res.status, data: null, rawText: '', isJson: false };
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: res.ok, status: res.status, data: null, rawText, isJson: false };
  }

  const contentType = res.headers.get('content-type') || '';
  const looksLikeJson =
    contentType.includes('application/json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');

  if (!looksLikeJson) {
    return { ok: res.ok, status: res.status, data: null, rawText, isJson: false };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    return { ok: res.ok, status: res.status, data: parsed, rawText, isJson: true };
  } catch {
    return { ok: res.ok, status: res.status, data: null, rawText, isJson: false };
  }
}

export async function safeFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeJsonResult<T>> {
  const res = await fetch(input, init);
  return safeReadJson<T>(res);
}

let cachedBackendCheck: Promise<boolean> | null = null;

/**
 * Checks whether the Express + WebSocket API server (/api/health) is running
 * on this host. Returns false on static hosts like Netlify or Firebase Hosting,
 * allowing SyncWatch to switch cleanly to Cloud Firestore real-time transport.
 */
export function checkBackendApiAvailable(forceRecheck = false): Promise<boolean> {
  if (!forceRecheck && cachedBackendCheck) return cachedBackendCheck;

  cachedBackendCheck = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const result = await safeFetchJson<{ status?: string }>('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return Boolean(result.ok && result.isJson && result.data?.status === 'ok');
    } catch {
      return false;
    }
  })();

  return cachedBackendCheck;
}
