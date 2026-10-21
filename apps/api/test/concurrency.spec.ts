import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, login, startApp, viaProxy } from './helpers/app';
import { persisted } from './helpers/audit';
import { createItem, resetDatabase, seedFixture, type Fixture } from './helpers/db';

// Brief test 8: a stale edit or competing review action, checking persisted state and audit consistency.
describe('concurrency', () => {
  let app: INestApplication;
  let f: Fixture;
  let managerA: string;
  let manager2A: string;
  let memberA: string;

  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    app = await startApp();
    managerA = await login(app, f.users.managerA.email);
    manager2A = await login(app, f.users.manager2A.email);
    memberA = await login(app, f.users.memberA.email);
  });
  afterAll(() => app.close());

  const as = (cookie: string) => ({ ...viaProxy(), Cookie: cookie });
  const act = (cookie: string, id: string, action: string, body: object) =>
    http(app).post(`/items/${id}/transitions/${action}`).set(as(cookie)).send(body);
  const newItem = (status: 'OPEN' | 'IN_PROGRESS' | 'PENDING_REVIEW' = 'OPEN') =>
    createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id, status });

  it('a stale edit returns 409, keeps the first edit and writes no audit row', async () => {
    const item = await newItem();
    const first = await http(app).patch(`/items/${item.id}`).set(as(managerA)).send({ version: 1, title: 'First' });
    expect(first.status).toBe(200);
    const stale = await http(app).patch(`/items/${item.id}`).set(as(manager2A)).send({ version: 1, title: 'Second' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('conflict');
    const db = await persisted(f.orgA, item.id);
    expect(db.item).toMatchObject({ title: 'First', version: 2 });
    expect(db.actions).toEqual(['EDITED']);
  });

  it('a manager edit made from a view older than a transition returns 409', async () => {
    const item = await newItem();
    await act(memberA, item.id, 'start', { version: 1 });
    const stale = await http(app).patch(`/items/${item.id}`).set(as(managerA)).send({ version: 1, title: 'x' });
    expect(stale.status).toBe(409);
    expect((await persisted(f.orgA, item.id)).actions).toEqual(['STARTED']);
  });

  it('two managers approving at once: one 200, one 409, one audit row', async () => {
    for (let run = 0; run < 5; run++) {
      const item = await newItem('PENDING_REVIEW');
      const results = await Promise.all([
        act(managerA, item.id, 'approve', { version: 1 }),
        act(manager2A, item.id, 'approve', { version: 1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const db = await persisted(f.orgA, item.id);
      expect(db.item).toMatchObject({ status: 'CLOSED', version: 2 });
      expect(db.actions).toEqual(['APPROVED']);
    }
  });

  it('approve vs request changes at once: exactly one wins and the audit agrees with the state', async () => {
    const item = await newItem('PENDING_REVIEW');
    const [a, b] = await Promise.all([
      act(managerA, item.id, 'approve', { version: 1 }),
      act(manager2A, item.id, 'request_changes', { version: 1, reason: 'Needs evidence.' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const db = await persisted(f.orgA, item.id);
    expect(db.audit).toHaveLength(1);
    expect(db.item.status).toBe(db.actions[0] === 'APPROVED' ? 'CLOSED' : 'IN_PROGRESS');
  });

  it('approving from a stale view after request-changes and resubmit returns 409', async () => {
    const item = await newItem('PENDING_REVIEW');
    // manager2A opened the item at version 1. Meanwhile:
    await act(managerA, item.id, 'request_changes', { version: 1, reason: 'Add the ticket link.' });
    await act(memberA, item.id, 'submit', { version: 2, completionNote: 'Link added.' });
    const stale = await act(manager2A, item.id, 'approve', { version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('conflict');
    const db = await persisted(f.orgA, item.id);
    expect(db.item).toMatchObject({ status: 'PENDING_REVIEW', version: 3 });
    expect(db.actions).toEqual(['CHANGES_REQUESTED', 'SUBMITTED']);
  });
});
