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

// Route handlers have no trustworthy socket address. Locally every request comes from
// this machine, so the API's per-IP login limit is shared (documented in the README).
// Behind a real load balancer, read the client IP from the header it sets.
const CLIENT_IP = '127.0.0.1';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = new URL(`/${path.map(encodeURIComponent).join('/')}`, process.env.API_URL);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-forwarded-for', CLIENT_IP);
  headers.set('x-internal-proxy-secret', process.env.PROXY_SECRET ?? '');

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
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
