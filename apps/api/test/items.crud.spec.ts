import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { createItem, owner, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Create, edit, list filters and bounds, with the audit rows each change writes.
describe('items: create, edit, list', () => {
  let app: INestApplication;
  let f: Fixture;
  let managerA: string;

  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
    managerA = await login(app, f.users.managerA.email);
  });
  afterAll(() => app.close());

  const as = (cookie: string) => ({ ...viaProxy(), Cookie: cookie });
  const auditFor = (itemId: string) =>
    owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${f.orgA}, true)`;
      return tx.auditEvent.findMany({ where: { itemId }, orderBy: { createdAt: 'asc' } });
    });

  it('a manager creates an item in their own org with one CREATED audit row', async () => {
    const res = await http(app)
      .post('/items')
      .set(as(managerA))
      .send({ title: '  Patch nginx  ', description: 'CVE', assigneeId: f.users.memberA.id, dueDate: '2099-03-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Patch nginx', status: 'OPEN', version: 1, dueDate: '2099-03-01', overdue: false });
    const audit = await auditFor(res.body.id);
    expect(audit.map((a) => a.action)).toEqual(['CREATED']);
    expect(audit[0].actorId).toBe(f.users.managerA.id);
  });

  it('an edit bumps the version and records from/to in the audit row', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id });
    const res = await http(app).patch(`/items/${item.id}`).set(as(managerA)).send({ version: 1, title: 'New title' });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    const audit = await auditFor(item.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'EDITED', changes: { title: { from: 'Rotate leaked key', to: 'New title' } } });
  });

  it('items under review or closed cannot be edited (409 invalid_transition)', async () => {
    const item = await createItem(f.orgA, {
      assigneeId: f.users.memberA.id,
      createdById: f.users.managerA.id,
      status: 'PENDING_REVIEW',
    });
    const res = await http(app).patch(`/items/${item.id}`).set(as(managerA)).send({ version: 1, title: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
  });

  it('rejects a disabled assignee with 422', async () => {
    await owner.user.update({ where: { id: f.users.member2A.id }, data: { disabledAt: new Date() } });
    const res = await http(app)
      .post('/items')
      .set(as(managerA))
      .send({ title: 'x', description: 'y', assigneeId: f.users.member2A.id, dueDate: '2099-01-01' });
    expect(res.status).toBe(422);
    await owner.user.update({ where: { id: f.users.member2A.id }, data: { disabledAt: null } });
  });

  it('filters overdue items (due before today UTC, not closed) and sorts by due date', async () => {
    await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, dueDate: '2001-01-02', title: 'late 2' });
    await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, dueDate: '2001-01-01', title: 'late 1' });
    await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, dueDate: '2001-01-01', status: 'CLOSED', title: 'closed' });
    const res = await http(app).get('/items?overdue=true').set(as(managerA));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(['late 1', 'late 2']);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((i: { overdue: boolean }) => i.overdue)).toBe(true);
  });

  it('bounds the page size and rejects unknown query params', async () => {
    expect((await http(app).get('/items?pageSize=51').set(as(managerA))).status).toBe(400);
    expect((await http(app).get('/items?orgId=x').set(as(managerA))).status).toBe(400);
    const page = await http(app).get('/items?pageSize=2&page=1').set(as(managerA));
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBeGreaterThan(2);
  });

  it('a malformed id is a plain 404', async () => {
    expect((await http(app).get('/items/not-a-uuid').set(as(managerA))).status).toBe(404);
  });

  it('rejects a version beyond the int4 range with 400, not 500', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id });
    const edit = await http(app).patch(`/items/${item.id}`).set(as(managerA)).send({ version: 3_000_000_000, title: 'x' });
    expect(edit.status).toBe(400);
    const start = await http(app).post(`/items/${item.id}/transitions/start`).set(as(managerA)).send({ version: 99_999_999_999 });
    expect(start.status).toBe(400);
  });

  it('an edit that changes nothing writes nothing (no version bump, no audit row)', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id });
    const res = await http(app)
      .patch(`/items/${item.id}`)
      .set(as(managerA))
      .send({ version: 1, title: 'Rotate leaked key', assigneeId: f.users.memberA.id });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(await auditFor(item.id)).toHaveLength(0);
  });
});
