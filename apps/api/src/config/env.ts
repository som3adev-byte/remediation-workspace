import { z } from 'zod';

// Validated once at boot. A missing or weak value stops the process instead of
// running with an insecure default.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') >= 32, 'JWT_SECRET must be at least 32 bytes.'),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  PROXY_SECRET: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') >= 32, 'PROXY_SECRET must be at least 32 bytes.'),
  WEB_ORIGIN: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  // Secure cookies everywhere except plain-http local development.
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
});

export type Env = z.infer<typeof schema> & { cookieSecure: boolean };

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Print only which variables are wrong, never their values.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  const e = parsed.data;
  cached = { ...e, cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production' };
  return cached;
}

/** Session and token lifetimes (see README "Session lifecycle"). */
export const AUTH = {
  cookieName: 'rw_session',
  tokenTtlSeconds: 15 * 60,
  reissueAfterSeconds: 10 * 60,
  sessionTtlSeconds: 8 * 60 * 60,
  throttleWindowSeconds: 15 * 60,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 20,
} as const;
