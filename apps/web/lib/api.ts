import type { ErrorCode } from '@rw/shared';

/** Any non-2xx answer, or a network failure (status 0). */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network_error',
    message: string,
    readonly requestId?: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const SESSION_EXPIRED_EVENT = 'rw:session-expired';
export const ITEMS_CHANGED_EVENT = 'rw:items-changed';

/**
 * The single fetch path for the browser. Everything goes to the same-origin /api proxy,
 * which carries the HttpOnly cookie. A 401 on any call except login/me announces that the
 * session ended, so the shell can show the "session expired" dialog once.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiFailure(0, 'network_error', 'Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body as T;

  const failure = new ApiFailure(
    res.status,
    body.code ?? 'internal_error',
    body.message ?? 'Something went wrong. Try again.',
    body.requestId ?? res.headers.get('x-request-id') ?? undefined,
    body.fields ?? {},
  );
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  throw failure;
}

export const notifyItemsChanged = () => window.dispatchEvent(new CustomEvent(ITEMS_CHANGED_EVENT));
