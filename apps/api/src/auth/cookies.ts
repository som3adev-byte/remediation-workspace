import type { CookieOptions, Response } from 'express';
import { AUTH, env } from '../config/env';

/**
 * HttpOnly: page scripts (and any XSS) cannot read the token.
 * SameSite=Strict: other sites cannot make the browser send it (CSRF), on top of the Origin check.
 * Secure: HTTPS only, except plain-http local development.
 */
function options(): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure: env().cookieSecure, path: '/' };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(AUTH.cookieName, token, { ...options(), maxAge: AUTH.sessionTtlSeconds * 1000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(AUTH.cookieName, options());
}
