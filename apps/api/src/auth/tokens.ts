import { errors, jwtVerify, SignJWT } from 'jose';
import { AUTH, env } from '../config/env';

/**
 * Access token: a short-lived JWT that only says "user X, session Y". It is never trusted
 * alone. AuthGuard always loads the session row and the user from the database, so a
 * revoked session or a disabled user is rejected even while the JWT is still valid.
 */
export interface TokenClaims {
  sub: string; // user id
  sid: string; // session id
  iat: number;
  exp: number;
}

const ALG = 'HS256';
const key = () => new TextEncoder().encode(env().JWT_SECRET);

export async function signAccessToken(userId: string, sessionId: string, sessionExpiresAt: Date): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // Never outlive the session's absolute cap.
  const exp = Math.min(now + AUTH.tokenTtlSeconds, Math.floor(sessionExpiresAt.getTime() / 1000));
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(env().JWT_ISSUER)
    .setAudience(env().JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key());
}

export type VerifyResult = { ok: true; claims: TokenClaims } | { ok: false; reason: 'expired' | 'invalid' };

/**
 * Accepts only HS256 signed by our key, with our issuer and audience, not expired, and
 * with sub/sid present. `alg: none`, RS256 tokens, tampered payloads, foreign issuers or
 * audiences and malformed strings are all "invalid"; an expired but otherwise valid token
 * is "expired" so the UI can show "session expired".
 */
export async function verifyAccessToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: [ALG],
      issuer: env().JWT_ISSUER,
      audience: env().JWT_AUDIENCE,
      requiredClaims: ['sub', 'sid', 'iat', 'exp'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return { ok: false, reason: 'invalid' };
    return { ok: true, claims: payload as unknown as TokenClaims };
  } catch (err) {
    if (err instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}
