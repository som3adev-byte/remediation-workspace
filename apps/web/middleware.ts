import { NextResponse, type NextRequest } from 'next/server';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy with a fresh nonce per request. Next.js reads the nonce from the
 * request's CSP header and puts it on its own scripts, so script-src needs no 'unsafe-inline':
 * only scripts carrying this response's nonce (and what they load, via 'strict-dynamic') run.
 * Styles keep 'unsafe-inline' for React style attributes. Dev mode adds 'unsafe-eval' and
 * websockets for hot reload.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
    "font-src 'self' https://cdn.fontshare.com https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

// Pages only: /api returns JSON, and static assets need no policy.
export const config = {
  matcher: [{ source: '/((?!api/|_next/static|_next/image|favicon.ico).*)' }],
};
