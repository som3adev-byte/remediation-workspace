import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';

/**
 * The browser's only way to the API: same origin, so the session cookie stays
 * HttpOnly + SameSite=Strict and the API never needs CORS.
 *   - forwards Origin unchanged (the API checks it on writes)
 *   - overwrites X-Forwarded-For (a client-sent value is never passed on)
 *   - adds the proxy secret (the API rejects requests without it)
 *   - relays Set-Cookie back to the browser
 */
const FORWARD_REQUEST = ['content-type', 'cookie', 'origin', 'accept'];
const FORWARD_RESPONSE = ['content-type', 'x-request-id', 'cache-control'];
// The API accepts 32 KB; the proxy refuses anything well above that before buffering it.
const MAX_BODY = 64 * 1024;
const tooLarge = () => Response.json({ code: 'validation_failed', message: 'Request body too large.' }, { status: 413 });

/** Reads the body up to MAX_BODY bytes; null means it was larger. */
async function readCapped(req: NextRequest): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * The client IP for the API's per-IP login limit. Route handlers have no trustworthy socket
 * address, and any X-Forwarded-For from the browser can be forged, so by default every request
 * counts as this machine (locally that is true; the limit is shared, see the README).
 * In production set TRUSTED_CLIENT_IP_HEADER to the header your load balancer sets. Its last
 * entry is the address the balancer saw; anything before it came from the client.
 */
function clientIp(req: NextRequest): string {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const reported = header ? req.headers.get(header)?.split(',').pop()?.trim() : undefined;
  return reported && isIP(reported) ? reported : '127.0.0.1';
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = new URL(`/${path.map(encodeURIComponent).join('/')}`, process.env.API_URL);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-forwarded-for', clientIp(req));
  headers.set('x-internal-proxy-secret', process.env.PROXY_SECRET ?? '');

  let payload: Uint8Array<ArrayBuffer> | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const read = await readCapped(req);
    if (read === null) return tooLarge();
    payload = read;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: payload,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { code: 'service_unavailable', message: 'The service is unavailable. Try again shortly.' },
      { status: 503 },
    );
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
