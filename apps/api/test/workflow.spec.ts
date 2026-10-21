import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { persisted } from './helpers/audit';
import { createItem, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 7: a valid workflow and an invalid transition.
describe('workflow', () => {
  let app: INestApplication;
  let f: Fixture;
  let managerA: string;
  let memberA: string;

  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
    managerA = await login(app, f.users.managerA.email);
    memberA = await login(app, f.users.memberA.email);
  });
  afterAll(() => app.close());

  const as = (cookie: string) => ({ ...viaProxy(), Cookie: cookie });
  const act = (cookie: string, id: string, action: string, body: object) =>
    http(app).post(`/items/${id}/transitions/${action}`).set(as(cookie)).send(body);

  it('Open → In progress → Pending review → Closed, one audit row per step', async () => {
    const created = await http(app)
      .post('/items')
      .set(as(managerA))
      .send({ title: 'Rotate DB password', description: 'Leaked in logs', assigneeId: f.users.memberA.id, dueDate: '2099-01-01' });
    const id = created.body.id;

    const start = await act(memberA, id, 'start', { version: 1 });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ status: 'IN_PROGRESS', version: 2 });

    const submit = await act(memberA, id, 'submit', { version: 2, completionNote: 'Rotated and redeployed.' });
    expect(submit.body).toMatchObject({ status: 'PENDING_REVIEW', version: 3, completionNote: 'Rotated and redeployed.' });

    const approve = await act(managerA, id, 'approve', { version: 3 });
    expect(approve.body).toMatchObject({ status: 'CLOSED', version: 4 });

    const db = await persisted(f.orgA, id);
    expect(db.item).toMatchObject({ status: 'CLOSED', version: 4 });
    expect(db.actions).toEqual(['CREATED', 'STARTED', 'SUBMITTED', 'APPROVED']);
    expect(db.audit.map((a) => a.actorId)).toEqual([
      f.users.managerA.id,
      f.users.memberA.id,
      f.users.memberA.id,
      f.users.managerA.id,
    ]);

    const activity = await http(app).get(`/items/${id}/activity`).set(as(memberA));
    expect(activity.body.map((a: { action: string }) => a.action)).toEqual(['APPROVED', 'SUBMITTED', 'STARTED', 'CREATED']);
  });

  it('approving an Open item is an invalid transition (409) and writes nothing', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id });
    const res = await act(managerA, item.id, 'approve', { version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
    const db = await persisted(f.orgA, item.id);
    expect(db.item).toMatchObject({ status: 'OPEN', version: 1 });
    expect(db.audit).toHaveLength(0);
  });

  it('a closed item is read-only: no edits, no transitions', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, status: 'CLOSED' });
    expect((await http(app).patch(`/items/${item.id}`).set(as(managerA)).send({ version: 1, title: 'x' })).status).toBe(409);
    for (const [cookie, action, body] of [
      [memberA, 'start', { version: 1 }],
      [memberA, 'submit', { version: 1, completionNote: 'x' }],
      [managerA, 'approve', { version: 1 }],
      [managerA, 'request_changes', { version: 1, reason: 'x' }],
    ] as const) {
      expect((await act(cookie, item.id, action, body)).status).toBe(409);
    }
    expect((await persisted(f.orgA, item.id)).audit).toHaveLength(0);
  });

  it('request changes needs a reason, keeps the completion note and records the reason', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, status: 'IN_PROGRESS' });
    await act(memberA, item.id, 'submit', { version: 1, completionNote: 'Done.' });
    expect((await act(managerA, item.id, 'request_changes', { version: 2, reason: '   ' })).status).toBe(400);
    const res = await act(managerA, item.id, 'request_changes', { version: 2, reason: 'Attach the scan output.' });
    expect(res.body).toMatchObject({ status: 'IN_PROGRESS', version: 3, completionNote: 'Done.' });
    const db = await persisted(f.orgA, item.id);
    expect(db.audit.at(-1)).toMatchObject({ action: 'CHANGES_REQUESTED', changes: { reason: 'Attach the scan output.' } });
  });

  it('validates transition bodies and unknown actions', async () => {
    const item = await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, status: 'IN_PROGRESS' });
    expect((await act(memberA, item.id, 'submit', { version: 1 })).status).toBe(400);
    expect((await act(memberA, item.id, 'submit', { version: 1, completionNote: 'x', status: 'CLOSED' })).status).toBe(400);
    expect((await act(memberA, item.id, 'close', { version: 1 })).status).toBe(404);
  });
});
