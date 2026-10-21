import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

// The Content-Security-Policy is set per request with a nonce in middleware.ts.
const securityHeaders = [
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
