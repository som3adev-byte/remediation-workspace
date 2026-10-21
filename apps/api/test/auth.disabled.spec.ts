import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { owner, PASSWORD, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 4: a disabled user being denied access.
describe('disabled user', () => {
  let app: INestApplication;
  let f: Fixture;
  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
  });
  afterAll(() => app.close());

  it('loses access on the next request, even with a valid session', async () => {
    const cookie = await login(app, f.users.memberA.email);
    await owner.user.update({ where: { id: f.users.memberA.id }, data: { disabledAt: new Date() } });
    const res = await http(app).get('/auth/me').set(viaProxy()).set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('session_expired');
  });

  it('cannot log in, and gets the same generic error as a wrong password', async () => {
    const res = await http(app).post('/auth/login').set(viaProxy('198.51.100.9')).send({ email: f.users.memberA.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'invalid_credentials', message: 'Invalid email or password.' });
  });
});
