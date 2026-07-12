import type { ApiErrorBody, AuthResultDto, ErrorCode } from '@pulsechat/shared';

/**
 * API client: attaches the in-memory access token, sends cookies (refresh),
 * and on a 401 transparently refreshes once and retries the request.
 */

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** The socket handshake reads the current token on every attempt. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** AuthProvider registers a handler that clears state when refresh fails. */
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

interface RequestOptions {
  body?: unknown;
  /** Skip the automatic refresh-and-retry (used by auth endpoints themselves). */
  noRetry?: boolean;
}

async function rawRequest(
  method: string,
  path: string,
  options: RequestOptions,
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

/**
 * Single-flight refresh: every caller in the app — the 401 auto-retry below
 * and AuthProvider's silent session restore on mount — shares this one
 * promise. Without that sharing, two near-simultaneous calls (e.g. React
 * StrictMode double-invoking an effect in dev) each present the same
 * pre-rotation refresh token; the server's rotation is now a compare-and-
 * swap, so the loser gets a clean 401 instead of corrupting the session —
 * but de-duplicating here means there's normally only ever one request.
 */
let refreshInFlight: Promise<AuthResultDto | null> | null = null;

export async function refreshSession(): Promise<AuthResultDto | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as AuthResultDto;
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function tryRefresh(): Promise<boolean> {
  return (await refreshSession()) !== null;
}

export async function api<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await rawRequest(method, path, options);

  if (response.status === 401 && !options.noRetry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) {
      response = await rawRequest(method, path, options);
    } else {
      onSessionExpired?.();
    }
  }

  if (!response.ok) {
    let errorBody: ApiErrorBody['error'] = { code: 'INTERNAL', message: 'Something went wrong' };
    try {
      errorBody = ((await response.json()) as ApiErrorBody).error ?? errorBody;
    } catch {
      // Non-JSON failure (network proxy, etc.) — keep the generic error.
    }
    throw new ApiError(response.status, errorBody);
  }
  return (await response.json()) as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, { body });
export const patch = <T>(path: string, body?: unknown) => api<T>('PATCH', path, { body });
export const del = <T>(path: string) => api<T>('DELETE', path);
