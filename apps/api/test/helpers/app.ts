import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import { createApp } from '../../src/app';
import { AUTH } from '../../src/config/env';
import { PASSWORD } from './db';

export const ORIGIN = process.env.WEB_ORIGIN!;
const SECRET = process.env.PROXY_SECRET!;

export async function startApp(): Promise<INestApplication> {
  const app = await createApp();
  await app.init();
  return app;
}

/** Headers the web proxy adds to every request. */
export function viaProxy(ip = '203.0.113.10') {
  return { 'x-internal-proxy-secret': SECRET, 'x-forwarded-for': ip, origin: ORIGIN };
}

export function http(app: INestApplication) {
  return request(app.getHttpServer());
}

/** Logs in and returns the session cookie string ("rw_session=..."). */
export async function login(app: INestApplication, email: string, password = PASSWORD, ip?: string): Promise<string> {
  const res = await http(app).post('/auth/login').set(viaProxy(ip)).send({ email, password });
  if (res.status !== 204) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return sessionCookie(res.headers['set-cookie']);
}

export function sessionCookie(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = list.find((v) => v.startsWith(`${AUTH.cookieName}=`) && !v.startsWith(`${AUTH.cookieName}=;`));
  if (!c) throw new Error('no session cookie set');
  return c.split(';')[0];
}

export const cookieFor = (token: string) => `${AUTH.cookieName}=${token}`;

/** Signs a token the way the API does, with overridable claims, for negative tests. */
export async function forgeToken(opts: {
  sub: string;
  sid: string;
  secret?: string;
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: opts.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(opts.sub)
    .setIssuer(opts.iss ?? process.env.JWT_ISSUER!)
    .setAudience(opts.aud ?? process.env.JWT_AUDIENCE!)
    .setIssuedAt(opts.iat ?? now)
    .setExpirationTime(opts.exp ?? now + 600)
    .sign(new TextEncoder().encode(opts.secret ?? process.env.JWT_SECRET!));
}
