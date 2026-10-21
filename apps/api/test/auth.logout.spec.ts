import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { owner, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 3: logout or session revocation preventing subsequent access.
describe('logout and revocation', () => {
  let app: INestApplication;
  let f: Fixture;
  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
  });
  afterAll(() => app.close());

  it('logout revokes the session, so the old cookie stops working', async () => {
    const cookie = await login(app, f.users.memberA.email);
    expect((await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie)).status).toBe(200);

    const out = await http(app).post('/auth/logout').set(viaProxy()).set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/rw_session=;/);

    const after = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('session_expired');
  });

  it('a session revoked server-side blocks a still-valid token', async () => {
    const cookie = await login(app, f.users.member2A.email);
    await owner.session.updateMany({ where: { userId: f.users.member2A.id }, data: { revokedAt: new Date() } });
    expect((await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie)).status).toBe(401);
  });

  it('logging out one session leaves the user\'s other sessions alone', async () => {
    const first = await login(app, f.users.managerA.email);
    const second = await login(app, f.users.managerA.email);
    await http(app).post('/auth/logout').set(viaProxy()).set('Cookie', first);
    expect((await http(app).get('/auth/me').set(viaProxy()).set('Cookie', second)).status).toBe(200);
  });
});
