import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { createItem, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 6: an unauthorized action within the same organization.
describe('same-organization authorization', () => {
  let app: INestApplication;
  let f: Fixture;
  let memberAItem: string;
  let memberA: string;
  let member2A: string;
  let managerA: string;

  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
    memberAItem = (await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id })).id;
    await createItem(f.orgA, { assigneeId: f.users.member2A.id, createdById: f.users.managerA.id });
    memberA = await login(app, f.users.memberA.email);
    member2A = await login(app, f.users.member2A.email);
    managerA = await login(app, f.users.managerA.email);
  });
  afterAll(() => app.close());

  const as = (cookie: string) => ({ ...viaProxy(), Cookie: cookie });

  it('a member only sees items assigned to them, and the count matches', async () => {
    const res = await http(app).get('/items').set(as(memberA));
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([memberAItem]);
  });

  it('a member cannot read another member’s item or its history (404)', async () => {
    expect((await http(app).get(`/items/${memberAItem}`).set(as(member2A))).status).toBe(404);
    expect((await http(app).get(`/items/${memberAItem}/activity`).set(as(member2A))).status).toBe(404);
  });

  it('a member cannot create items or edit their own item (403)', async () => {
    const create = await http(app)
      .post('/items')
      .set(as(memberA))
      .send({ title: 'x', description: 'y', assigneeId: f.users.memberA.id, dueDate: '2099-01-01' });
    expect(create.status).toBe(403);
    const edit = await http(app).patch(`/items/${memberAItem}`).set(as(memberA)).send({ version: 1, title: 'mine now' });
    expect(edit.status).toBe(403);
    expect((await http(app).get('/items/assignees').set(as(memberA))).status).toBe(403);
  });

  it('a manager cannot review an item assigned to themselves (403)', async () => {
    const own = await createItem(f.orgA, { assigneeId: f.users.managerA.id, createdById: f.users.manager2A.id, status: 'PENDING_REVIEW' });
    const approve = await http(app).post(`/items/${own.id}/transitions/approve`).set(as(managerA)).send({ version: 1 });
    expect(approve.status).toBe(403);
    const changes = await http(app)
      .post(`/items/${own.id}/transitions/request_changes`)
      .set(as(managerA))
      .send({ version: 1, reason: 'x' });
    expect(changes.status).toBe(403);
  });

  it('only the assignee can start or submit; a member cannot review (403)', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id });
    expect((await http(app).post(`/items/${item.id}/transitions/start`).set(as(managerA)).send({ version: 1 })).status).toBe(403);
    const pending = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, status: 'PENDING_REVIEW' });
    expect((await http(app).post(`/items/${pending.id}/transitions/approve`).set(as(memberA)).send({ version: 1 })).status).toBe(403);
  });

  it('a reassigned member loses access on their very next request (404)', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id });
    expect((await http(app).get(`/items/${item.id}`).set(as(memberA))).status).toBe(200);
    const res = await http(app)
      .patch(`/items/${item.id}`)
      .set(as(managerA))
      .send({ version: 1, assigneeId: f.users.member2A.id });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect((await http(app).get(`/items/${item.id}`).set(as(memberA))).status).toBe(404);
    expect((await http(app).get(`/items/${item.id}`).set(as(member2A))).status).toBe(200);
  });
});
