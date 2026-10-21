import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/db/prisma.service';
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

  it('a rejected session clears the cookie; a database outage keeps it', async () => {
    const cookie = await login(app, f.users.memberB.email);
    const clears = (res: { headers: Record<string, unknown> }) => /rw_session=;/.test(String(res.headers['set-cookie']));

    // Database unreachable during the session check: 503, and the user stays signed in.
    const prisma = app.get(PrismaService);
    const spy = vi
      .spyOn(prisma.session, 'findUnique')
      .mockRejectedValueOnce(new Prisma.PrismaClientInitializationError("Can't reach database server", '6.0.0'));
    const outage = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie);
    spy.mockRestore();
    expect(outage.status).toBe(503);
    expect(clears(outage)).toBe(false);
    expect((await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie)).status).toBe(200);

    // Session revoked: 401, and the cookie is cleared.
    await owner.session.updateMany({ where: { userId: f.users.memberB.id }, data: { revokedAt: new Date() } });
    const rejected = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie);
    expect(rejected.status).toBe(401);
    expect(clears(rejected)).toBe(true);
  });
});
