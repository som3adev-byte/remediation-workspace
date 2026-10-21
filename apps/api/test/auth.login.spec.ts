import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 1: successful login and an authenticated request.
describe('login and an authenticated request', () => {
  let app: INestApplication;
  let f: Fixture;
  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
  });
  afterAll(() => app.close());

  it('sets an HttpOnly, SameSite=Strict session cookie and no token in the body', async () => {
    const res = await http(app)
      .post('/auth/login')
      .set(viaProxy())
      .send({ email: '  MANAGER.A@test.dev ', password: 'correct horse battery staple' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/rw_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('returns the identity loaded from the database for GET /auth/me', async () => {
    const cookie = await login(app, f.users.memberA.email);
    const res = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: f.users.memberA.id, role: 'MEMBER', org: { id: f.orgA } });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('rejects an unauthenticated request', async () => {
    const res = await http(app).get('/auth/me').set(viaProxy());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'unauthenticated' });
    expect(res.body.requestId).toMatch(/^req_/);
  });

  it('ignores caller-supplied identity fields', async () => {
    const res = await http(app)
      .post('/auth/login')
      .set(viaProxy())
      .send({ email: f.users.memberA.email, password: 'correct horse battery staple', role: 'MANAGER', orgId: f.orgB });
    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ role: expect.any(String), orgId: expect.any(String) });
  });
});
