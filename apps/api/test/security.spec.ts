import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, ORIGIN, startApp, viaProxy } from './helpers/app';
import { PASSWORD, resetDatabase, seedFixture, type Fixture } from './helpers/db';

describe('origin, proxy and throttling', () => {
  let app: INestApplication;
  let f: Fixture;
  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
  });
  afterAll(() => app.close());

  it('rejects a request that did not come through the web proxy (no secret)', async () => {
    const res = await http(app).post('/auth/login').set({ origin: ORIGIN }).send({ email: f.users.memberA.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rejects a state-changing request with a missing Origin', async () => {
    const { origin: _o, ...noOrigin } = viaProxy();
    const res = await http(app).post('/auth/login').set(noOrigin).send({ email: f.users.memberA.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('origin_rejected');
  });

  it('rejects a state-changing request from a foreign Origin', async () => {
    const res = await http(app).post('/auth/logout').set({ ...viaProxy(), origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('allows a GET without Origin (safe method)', async () => {
    const cookie = await login(app, f.users.memberA.email);
    const { origin: _o, ...noOrigin } = viaProxy();
    expect((await http(app).get('/auth/me').set(noOrigin).set('Cookie', cookie)).status).toBe(200);
  });

  it('throttles an unknown and a real email at the same attempt with the same 429', async () => {
    const tryLogin = (email: string, ip: string) =>
      http(app).post('/auth/login').set(viaProxy(ip)).send({ email, password: 'wrong-password' });
    for (let i = 0; i < 5; i++) {
      expect((await tryLogin(f.users.member2A.email, `192.0.2.${i + 1}`)).status).toBe(401);
      expect((await tryLogin('nobody@test.dev', `192.0.2.${i + 101}`)).status).toBe(401);
    }
    const real = await tryLogin(f.users.member2A.email, '192.0.2.50');
    const unknown = await tryLogin('nobody@test.dev', '192.0.2.150');
    expect(real.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(real.body.message).toBe(unknown.body.message);
    // Even the correct password is refused while the email is throttled.
    const correct = await http(app).post('/auth/login').set(viaProxy('192.0.2.51')).send({ email: f.users.member2A.email, password: PASSWORD });
    expect(correct.status).toBe(429);
  });

  it('throttles by client IP across different emails', async () => {
    for (let i = 0; i < 20; i++) {
      await http(app).post('/auth/login').set(viaProxy('203.0.113.77')).send({ email: `x${i}@test.dev`, password: 'nope' });
    }
    const res = await http(app).post('/auth/login').set(viaProxy('203.0.113.77')).send({ email: f.users.managerA.email, password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('does not leak stack traces or internals in error bodies', async () => {
    const res = await http(app).post('/auth/login').set(viaProxy()).set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules|SyntaxError/);
  });
});
