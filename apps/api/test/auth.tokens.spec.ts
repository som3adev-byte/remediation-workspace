import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFor, forgeToken, http, login, startApp, viaProxy } from './helpers/app';
import { owner, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 2: invalid credentials and malformed, tampered, expired, wrong-issuer and wrong-audience tokens.
describe('invalid credentials and invalid tokens', () => {
  let app: INestApplication;
  let f: Fixture;
  let sid: string;
  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
    await login(app, f.users.memberA.email);
    sid = (await owner.session.findFirstOrThrow({ where: { userId: f.users.memberA.id } })).id;
  });
  afterAll(() => app.close());

  it('returns the same 401 body for a wrong password and an unknown email', async () => {
    const wrong = await http(app).post('/auth/login').set(viaProxy('198.51.100.1')).send({ email: f.users.memberA.email, password: 'nope' });
    const unknown = await http(app).post('/auth/login').set(viaProxy('198.51.100.2')).send({ email: 'ghost@test.dev', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = ({ requestId: _r, ...rest }: Record<string, unknown>) => rest;
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(wrong.body).toMatchObject({ code: 'invalid_credentials', message: 'Invalid email or password.' });
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  const me = (cookie: string) => http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie);

  it('accepts a correctly signed token (control case)', async () => {
    const token = await forgeToken({ sub: f.users.memberA.id, sid });
    expect((await me(cookieFor(token))).status).toBe(200);
  });

  it('rejects a malformed token', async () => {
    const res = await me(cookieFor('not-a-jwt'));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthenticated');
  });

  it('rejects a token whose payload was tampered with', async () => {
    const token = await forgeToken({ sub: f.users.memberA.id, sid });
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.sub = f.users.managerA.id; // try to become the manager
    const tampered = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
    expect((await me(cookieFor(tampered))).status).toBe(401);
  });

  it('rejects a token signed with another key', async () => {
    const token = await forgeToken({ sub: f.users.memberA.id, sid, secret: 'x'.repeat(48) });
    expect((await me(cookieFor(token))).status).toBe(401);
  });

  it('rejects an unsigned alg=none token', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: f.users.memberA.id, sid, iss: process.env.JWT_ISSUER, aud: process.env.JWT_AUDIENCE, iat: now, exp: now + 600 })}.`;
    expect((await me(cookieFor(none))).status).toBe(401);
  });

  it('rejects an expired token with session_expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await forgeToken({ sub: f.users.memberA.id, sid, iat: past - 900, exp: past });
    const res = await me(cookieFor(token));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('session_expired');
  });

  it('rejects a token from another issuer', async () => {
    const token = await forgeToken({ sub: f.users.memberA.id, sid, iss: 'someone-else' });
    expect((await me(cookieFor(token))).status).toBe(401);
  });

  it('rejects a token for another audience', async () => {
    const token = await forgeToken({ sub: f.users.memberA.id, sid, aud: 'another-app' });
    expect((await me(cookieFor(token))).status).toBe(401);
  });

  it('rejects a valid signature pointing at a session that belongs to someone else', async () => {
    const token = await forgeToken({ sub: f.users.managerA.id, sid });
    expect((await me(cookieFor(token))).status).toBe(401);
  });
});

describe('silent reissue', () => {
  let app: INestApplication;
  let f: Fixture;
  let sid: string;
  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
    await login(app, f.users.memberA.email);
    sid = (await owner.session.findFirstOrThrow({ where: { userId: f.users.memberA.id } })).id;
  });
  afterAll(() => app.close());

  it('issues a fresh cookie when the token is older than 10 minutes', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = await forgeToken({ sub: f.users.memberA.id, sid, iat: now - 11 * 60, exp: now + 4 * 60 });
    const res = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookieFor(old));
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/rw_session=ey/);
  });

  it('does not reissue a fresh token', async () => {
    const fresh = await forgeToken({ sub: f.users.memberA.id, sid });
    const res = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookieFor(fresh));
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('never reissues past the session\'s absolute expiry', async () => {
    await owner.session.update({ where: { id: sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const now = Math.floor(Date.now() / 1000);
    const old = await forgeToken({ sub: f.users.memberA.id, sid, iat: now - 11 * 60, exp: now + 4 * 60 });
    const res = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookieFor(old));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('session_expired');
  });
});
