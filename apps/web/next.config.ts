import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy. The page only talks to its own origin (all data goes through
 * /api), so connect-src is 'self'; fonts come from two named CDNs. Next.js injects inline
 * bootstrap scripts, so script-src needs 'unsafe-inline' without a per-request nonce;
 * external script hosts, framing, plugins, <base> and cross-origin form posts are blocked.
 * Dev mode adds 'unsafe-eval' and websockets for hot reload.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
  "font-src 'self' https://cdn.fontshare.com https://fonts.gstatic.com",
  "img-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // HTTPS only in production; plain-http local development would ignore it anyway.
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@rw/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
