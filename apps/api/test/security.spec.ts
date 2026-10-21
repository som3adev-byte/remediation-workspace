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

  it('rejects an oversized body with 413, not 500', async () => {
    const cookie = await login(app, f.users.managerA.email);
    const res = await http(app)
      .post('/items')
      .set({ ...viaProxy(), Cookie: cookie })
      .send({ title: 'x', description: 'a'.repeat(40_000), assigneeId: f.users.memberA.id, dueDate: '2099-01-01' });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('validation_failed');
  });

  it('holds the per-email limit under a burst of parallel wrong passwords', async () => {
    // Each request comes from its own IP so only the per-email limit is in play.
    const email = 'burst.target@test.dev';
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, k) =>
        http(app).post('/auth/login').set(viaProxy(`198.51.100.${k + 1}`)).send({ email, password: 'wrong-password' }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(15);
  });

  it('maps other body-parser client errors to their 4xx, not 500', async () => {
    const res = await http(app)
      .post('/auth/login')
      .set({ ...viaProxy('203.0.113.77'), 'content-type': 'application/json; charset=latin9' })
      .send('{"email":"a@b.test","password":"x"}');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('validation_failed');
  });
});
