import axios, { AxiosError } from 'axios';
import type { ApiEnvelope, Paginated } from './types';
import { useAuthStore } from '@/store/auth-store';
import { tenantLoginPath } from '@/lib/tenant-path';

/** Pagination meta the backend sends alongside list payloads (@sharptalk/types PaginationMeta). */
interface PaginationMeta {
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

/** For URLs built outside axios (public asset links, e.g. the widget logo). */
export const apiBaseUrl = (): string => baseURL.replace(/\/+$/, '');

export const http = axios.create({ baseURL });

/**
 * Absolute URL for an attachment link (PLN-260814). The API returns the path
 * (`/api/v1/files/…`) because the widget and the console reach the API on
 * different origins; each client resolves it against its own base. Resolving
 * against the base's ORIGIN, not the base path, is what keeps `/api/v1` from
 * appearing twice.
 */
export const resolveFileUrl = (path: string): string => {
  if (/^https?:\/\//i.test(path)) return path;
  try {
    return new URL(path, new URL(baseURL, window.location.href).origin).href;
  } catch {
    return path;
  }
};

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Single-flight silent refresh (REQ-260825 R1). Parallel 401s share one
 * /auth/refresh call; the token is rotated in the store and the winners retry.
 * Raw axios on purpose — this call must never re-enter these interceptors.
 * The refresh token itself stays memory-only (FE-H1), so a page reload still
 * runs on the access token's remaining lifetime alone.
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) return null;
      try {
        const res = await axios.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>(
          `${apiBaseUrl()}/auth/refresh`,
          { refresh_token: refreshToken },
        );
        const data = res.data?.success ? res.data.data : null;
        if (!data?.accessToken || !data.refreshToken) return null;
        useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
        return data.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

http.interceptors.response.use(
  (response) => {
    const body = response.data as (ApiEnvelope<unknown> & { pagination?: PaginationMeta }) | undefined;
    if (body && typeof body === 'object' && 'success' in body) {
      if (!body.success) {
        throw new Error(body.error?.message || 'Request failed');
      }
      response.data = body.data;
      // Preserve list pagination for apiGetList without changing the shape
      // bare-array consumers (apiGet) already rely on.
      if (body.pagination) {
        (response as { __pagination?: PaginationMeta }).__pagination = body.pagination;
      }
    }
    return response;
  },
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    // A 401 from a PUBLIC auth attempt (login, SSO, MFA verify, password
    // recovery) is that form's own feedback — bouncing to a login page would
    // eat the error and, for a first-time visitor (no stored tenantSlug),
    // dump them on the landing page mid-flow (found via PLN-260824 S3).
    const requestUrl = error.config?.url ?? '';
    const isPublicAuthAttempt =
      /\/auth\/(user\/login|admin\/login|sso\/ama|mfa\/verify|password\/)/.test(requestUrl);
    if (error.response?.status === 401 && !isPublicAuthAttempt) {
      // Silent refresh first (REQ-260825 R1): one retry per request. A second
      // 401 on the retried request (or no/expired refresh token) falls through
      // to the logout redirect, which is exactly the pre-R1 behaviour.
      const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
      if (original && !original._retried) {
        const fresh = await refreshAccessToken();
        if (fresh) {
          original._retried = true;
          original.headers = original.headers ?? {};
          original.headers.Authorization = `Bearer ${fresh}`;
          return http.request(original);
        }
      }
      const store = useAuthStore.getState();
      // Route back to the matching login page: /admin/* → admin login, tenant
      // users → their /<slug> page, otherwise the public landing page. When the
      // 401 IS the login attempt (already on the target page) we only clear.
      const isAdminContext =
        store.principal?.actorType === 'admin' || window.location.pathname.startsWith('/admin');
      const target = isAdminContext ? '/admin/login' : store.tenantSlug ? tenantLoginPath(store.tenantSlug) : '/';
      store.clear();
      if (window.location.pathname !== target) {
        window.location.href = target;
      }
    }
    const envelope = error.response?.data;
    const message =
      (envelope && typeof envelope === 'object' && envelope.error?.message) ||
      error.message ||
      'Request failed';
    const wrapped = new Error(message) as Error & { status?: number; code?: string };
    wrapped.status = error.response?.status;
    wrapped.code = envelope?.error?.code;
    return Promise.reject(wrapped);
  },
);

// Helpers that return the unwrapped data directly.
export const apiGet = async <T>(url: string, params?: unknown): Promise<T> => {
  const res = await http.get<T>(url, { params: params as object });
  return res.data;
};

/**
 * List fetch that reconstructs the `{ items, total, page, pageSize }` shape from
 * the standard list envelope. Use for endpoints that return `new Paginated(...)`
 * on the backend; plain `apiGet` still returns the bare `data` array.
 */
export const apiGetList = async <T>(url: string, params?: unknown): Promise<Paginated<T>> => {
  const res = await http.get<T[]>(url, { params: params as object });
  const p = (res as { __pagination?: PaginationMeta }).__pagination;
  return {
    items: (res.data ?? []) as T[],
    total: p?.totalCount ?? (Array.isArray(res.data) ? res.data.length : 0),
    page: p?.page ?? 1,
    pageSize: p?.size ?? 0,
  };
};

/**
 * Authenticated file download. The envelope interceptor leaves Blob bodies
 * alone (no `success` key on a Blob), so this receives the raw bytes; the
 * filename comes from Content-Disposition so the server names the file.
 */
export const apiGetBlob = async (
  url: string,
  params?: unknown,
): Promise<{ blob: Blob; filename: string | null }> => {
  const res = await http.get<Blob>(url, { params: params as object, responseType: 'blob' });
  const cd = String(res.headers?.['content-disposition'] ?? '');
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  const filename = star ? decodeURIComponent(star[1]) : plain ? plain[1] : null;
  return { blob: res.data, filename };
};

/** Hand a downloaded blob to the browser's save flow. */
export const saveBlob = (blob: Blob, filename: string): void => {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
};

/**
 * Same list envelope as `apiGetList`, but the query travels in the body.
 *
 * Used where the query itself is personal data (a shopper's address): a query
 * string is copied into every proxy access log and the operator's browser
 * history, and neither of those is covered by the retention window (PLN-260920).
 */
export const apiPostList = async <T>(url: string, data?: unknown): Promise<Paginated<T>> => {
  const res = await http.post<T[]>(url, data);
  const p = (res as { __pagination?: PaginationMeta }).__pagination;
  return {
    items: (res.data ?? []) as T[],
    total: p?.totalCount ?? (Array.isArray(res.data) ? res.data.length : 0),
    page: p?.page ?? 1,
    pageSize: p?.size ?? 0,
  };
};

export const apiPost = async <T>(url: string, data?: unknown): Promise<T> => {
  const res = await http.post<T>(url, data);
  return res.data;
};

/**
 * Multipart POST. The Content-Type header is deliberately left unset: the
 * browser has to add the multipart boundary itself, and setting it by hand
 * produces a request the server parses as an empty body.
 */
export const apiPostForm = async <T>(url: string, form: FormData): Promise<T> => {
  const res = await http.post<T>(url, form);
  return res.data;
};

/** apiPostForm plus upload progress — same Content-Type caveat applies. */
export const apiUpload = async <T>(
  url: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> => {
  const res = await http.post<T>(url, form, {
    onUploadProgress: (e) => {
      if (!onProgress || !e.total) return;
      onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    },
  });
  return res.data;
};

export const apiPut = async <T>(url: string, data?: unknown): Promise<T> => {
  const res = await http.put<T>(url, data);
  return res.data;
};

export const apiPatch = async <T>(url: string, data?: unknown): Promise<T> => {
  const res = await http.patch<T>(url, data);
  return res.data;
};

export const apiDelete = async <T>(url: string): Promise<T> => {
  const res = await http.delete<T>(url);
  return res.data;
};

export const getErrorStatus = (err: unknown): number | undefined => {
  if (err && typeof err === 'object' && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
};
