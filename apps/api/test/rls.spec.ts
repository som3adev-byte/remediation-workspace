import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inOrgTransaction } from '../src/db/org-transaction';
import { createItem, owner, resetDatabase, runtime, seedFixture, type Fixture } from './helpers/db';

// Database-level isolation, checked directly against Postgres as the runtime role.
describe('row-level security (runtime role)', () => {
  let f: Fixture;
  beforeAll(async () => {
    await resetDatabase();
    f = await seedFixture();
    await createItem(f.orgA, { assigneeId: f.users.memberA.id, createdById: f.users.managerA.id });
    await createItem(f.orgB, { assigneeId: f.users.memberB.id, createdById: f.users.managerB.id });
  });
  afterAll(async () => {
    await owner.$disconnect();
    await runtime.$disconnect();
  });

  it('returns no rows when app.org_id is not set (fails closed)', async () => {
    expect(await runtime.item.count()).toBe(0);
    expect(await runtime.auditEvent.count()).toBe(0);
  });

  it('shows only the current org inside an org transaction', async () => {
    const seen = await inOrgTransaction(runtime, f.orgA, (tx) => tx.item.findMany({ select: { orgId: true } }));
    expect(seen).toHaveLength(1);
    expect(seen.every((i) => i.orgId === f.orgA)).toBe(true);
  });

  it('rejects inserting an item without app.org_id', async () => {
    await expect(
      runtime.item.create({
        data: {
          orgId: f.orgA,
          title: 't',
          description: 'd',
          assigneeId: f.users.memberA.id,
          createdById: f.users.managerA.id,
          dueDate: new Date('2099-01-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects inserting an item for another org while scoped to org A', async () => {
    await expect(
      inOrgTransaction(runtime, f.orgA, (tx) =>
        tx.item.create({
          data: {
            orgId: f.orgB,
            title: 't',
            description: 'd',
            assigneeId: f.users.memberB.id,
            createdById: f.users.managerB.id,
            dueDate: new Date('2099-01-01T00:00:00Z'),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update or delete audit events, and cannot delete items', async () => {
    const item = await inOrgTransaction(runtime, f.orgA, (tx) => tx.item.findFirstOrThrow());
    await inOrgTransaction(runtime, f.orgA, (tx) =>
      tx.auditEvent.create({ data: { orgId: f.orgA, itemId: item.id, actorId: f.users.managerA.id, action: 'CREATED' } }),
    );
    await expect(
      inOrgTransaction(runtime, f.orgA, (tx) => tx.auditEvent.updateMany({ data: { action: 'EDITED' } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(inOrgTransaction(runtime, f.orgA, (tx) => tx.auditEvent.deleteMany())).rejects.toThrow(
      /permission denied/i,
    );
    await expect(inOrgTransaction(runtime, f.orgA, (tx) => tx.item.deleteMany())).rejects.toThrow(/permission denied/i);
  });

  it('cannot write users or organizations from the runtime role', async () => {
    await expect(runtime.organization.create({ data: { name: 'x' } })).rejects.toThrow(/permission denied/i);
  });
});
