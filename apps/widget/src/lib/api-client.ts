import axios, { AxiosError } from 'axios';

/**
 * API base, resolved at RUNTIME (PLN-260819 S3).
 *
 * It used to be `import.meta.env.VITE_API_BASE_URL`, which Vite inlines at build
 * time — so every customer needed their own bundle. Now the deployment drops a
 * `widget-config.json` next to the bundle and one build serves them all.
 *
 * Resolution order, most specific first:
 *   1. `window.__SHOPTALK_CONFIG__.apiBase`  — set by the pre-boot config fetch
 *   2. `VITE_API_BASE_URL`                   — dev convenience, still honoured
 *   3. same origin `/api/v1`                 — what a co-deployed stack serves
 *
 * Deliberately NOT read from the URL: a query parameter would let any page point
 * the widget at an API of its choosing.
 */
function resolveBaseUrl(): string {
  const injected = (window as unknown as { __SHOPTALK_CONFIG__?: { apiBase?: string } })
    .__SHOPTALK_CONFIG__?.apiBase;
  if (injected) return injected.replace(/\/+$/, '');
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  if (fromEnv) return String(fromEnv).replace(/\/+$/, '');
  return `${window.location.origin}/api/v1`;
}

const BASE_URL = resolveBaseUrl();

/** API base without a trailing slash — for URLs built outside the axios client. */
export function apiOrigin(): string {
  return BASE_URL;
}

export const SESSION_STORAGE_KEY = 'ivy_session';

export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(SESSION_STORAGE_KEY, token);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore storage failures */
  }
}

/** Standard API envelope. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code?: string; message?: string } | string | null;
}

const raw = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// PRV-M7/FE-M3: keep the session token out of URLs. For GET requests the token
// would otherwise ride in the query string and leak into browser history, proxy
// logs, and the Referer header — so lift it into the X-Session-Token header and
// strip it from the params. POST/PUT bodies don't leak, so they're left as-is.
raw.interceptors.request.use((config) => {
  const params = config.params as Record<string, unknown> | undefined;
  const token = params?.session_token;
  if (typeof token === 'string' && token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)['X-Session-Token'] = token;
    const { session_token: _omit, ...rest } = params!;
    config.params = rest;
  }
  return config;
});

function unwrapError(err: unknown): Error {
  if (err instanceof AxiosError) {
    const env = err.response?.data as ApiEnvelope<unknown> | undefined;
    const e = env?.error;
    const msg =
      typeof e === 'string'
        ? e
        : e?.message || err.message || 'Request failed';
    const wrapped = new Error(msg) as Error & { status?: number; code?: string };
    wrapped.status = err.response?.status;
    if (e && typeof e !== 'string') wrapped.code = e.code;
    return wrapped;
  }
  return err instanceof Error ? err : new Error('Unknown error');
}

/** Unwrap the envelope: return `data` on success, throw `error` otherwise. */
async function unwrap<T>(p: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  try {
    const res = await p;
    const env = res.data;
    if (env && env.success) return env.data;
    const e = env?.error;
    const msg =
      typeof e === 'string' ? e : e?.message || 'Request failed';
    throw new Error(msg);
  } catch (err) {
    throw unwrapError(err);
  }
}

export const apiClient = {
  get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return unwrap<T>(raw.get(url, { params }));
  },
  post<T>(url: string, body?: unknown): Promise<T> {
    return unwrap<T>(raw.post(url, body));
  },
  put<T>(url: string, body?: unknown): Promise<T> {
    return unwrap<T>(raw.put(url, body));
  },
  /** DELETE with a JSON body (session token + ids) — axios carries it via `data`. */
  delete<T>(url: string, body?: unknown): Promise<T> {
    return unwrap<T>(raw.delete(url, { data: body }));
  },
  /**
   * Multipart upload with progress (PLN-260814). Content-Type is deleted, not
   * set: the browser has to add the multipart boundary itself, and the client
   * default would overwrite it.
   */
  upload<T>(
    url: string,
    file: File,
    sessionToken: string,
    onProgress?: (percent: number) => void,
  ): Promise<T> {
    const form = new FormData();
    form.append('file', file);
    return unwrap<T>(
      raw.post(url, form, {
        headers: { 'Content-Type': undefined, 'X-Session-Token': sessionToken },
        onUploadProgress: (e) => {
          if (!onProgress || !e.total) return;
          onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        },
      }),
    );
  },
};

/**
 * Absolute URL for an attachment link. The API returns a path because the
 * widget runs on the merchant's storefront origin — resolving it here against
 * the API's ORIGIN (not its base path) is what stops `/api/v1` doubling up.
 */
export function resolveFileUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  try {
    return new URL(path, new URL(BASE_URL, window.location.href).origin).href;
  } catch {
    return path;
  }
}
