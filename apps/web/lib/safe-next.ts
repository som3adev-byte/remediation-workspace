/**
 * Where to go after sign-in. Only a path on this same origin is accepted; anything else
 * (another host, protocol-relative "//evil", "javascript:", backslash tricks) falls back.
 */
export function safeNext(raw: string | null | undefined, origin: string, fallback = '/items'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    // The parser resolves "/%2e%2e//host" to the path "//host", which a browser reads as another site.
    if (url.pathname.startsWith('//')) return fallback;
    if (url.pathname === '/login') return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
