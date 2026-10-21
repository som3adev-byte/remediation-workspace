import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { createItem, owner, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 5: cross-organization access attempts against reads and mutations.
describe('cross-organization access', () => {
  let app: INestApplication;
  let f: Fixture;
  let itemA: string;
  let managerB: string;
  let managerA: string;

  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
    itemA = (await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id })).id;
    managerB = await login(app, f.users.managerB.email);
    managerA = await login(app, f.users.managerA.email);
  });
  afterAll(() => app.close());

  const as = (cookie: string) => ({ ...viaProxy(), Cookie: cookie });

  it('list and count never include another org’s items', async () => {
    const res = await http(app).get('/items').set(as(managerB));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('detail and history of another org’s item return 404', async () => {
    expect((await http(app).get(`/items/${itemA}`).set(as(managerB))).status).toBe(404);
    expect((await http(app).get(`/items/${itemA}/activity`).set(as(managerB))).status).toBe(404);
  });

  it('edit and reassign of another org’s item return 404 and change nothing', async () => {
    const edit = await http(app).patch(`/items/${itemA}`).set(as(managerB)).send({ version: 1, title: 'pwned' });
    expect(edit.status).toBe(404);
    const reassign = await http(app)
      .patch(`/items/${itemA}`)
      .set(as(managerB))
      .send({ version: 1, assigneeId: f.users.memberB.id });
    expect(reassign.status).toBe(404);
    const row = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${f.orgA}, true)`;
      return tx.item.findUniqueOrThrow({ where: { id: itemA } });
    });
    expect(row).toMatchObject({ title: 'Rotate leaked key', assigneeId: f.users.memberA.id, version: 1 });
  });

  it('every transition on another org’s item returns 404', async () => {
    const memberB = await login(app, f.users.memberB.email);
    for (const [cookie, action, body] of [
      [memberB, 'start', { version: 1 }],
      [memberB, 'submit', { version: 1, completionNote: 'x' }],
      [managerB, 'approve', { version: 1 }],
      [managerB, 'request_changes', { version: 1, reason: 'x' }],
    ] as const) {
      const res = await http(app).post(`/items/${itemA}/transitions/${action}`).set(as(cookie)).send(body);
      expect(res.status).toBe(404);
    }
  });

  it('assigning to a user in another org returns 422 on create and reassign', async () => {
    const create = await http(app)
      .post('/items')
      .set(as(managerA))
      .send({ title: 'x', description: 'y', assigneeId: f.users.memberB.id, dueDate: '2099-01-01' });
    expect(create.status).toBe(422);
    expect(create.body.code).toBe('invalid_assignee');
    const reassign = await http(app)
      .patch(`/items/${itemA}`)
      .set(as(managerA))
      .send({ version: 1, assigneeId: f.users.memberB.id });
    expect(reassign.status).toBe(422);
  });

  it('orgId in the request body is rejected, never trusted', async () => {
    const res = await http(app)
      .post('/items')
      .set(as(managerB))
      .send({ title: 'x', description: 'y', assigneeId: f.users.memberB.id, dueDate: '2099-01-01', orgId: f.orgA });
    expect(res.status).toBe(400);
    expect(res.body.fields.orgId).toBeDefined();
  });

  it('the assignee list only contains the manager’s own org', async () => {
    const res = await http(app).get('/items/assignees').set(as(managerB));
    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id).sort()).toEqual([f.users.managerB.id, f.users.memberB.id].sort());
  });
});
