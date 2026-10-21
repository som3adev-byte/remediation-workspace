import { PrismaClient, type ItemStatus, type Role } from '@prisma/client';
import argon2 from 'argon2';
import { inOrgTransaction } from '../../src/db/org-transaction';

/** Owner connection: resets and builds fixtures. FORCE RLS still applies, so items go through inOrgTransaction. */
export const owner = new PrismaClient({ datasourceUrl: process.env.TEST_MIGRATION_DATABASE_URL });
/** Runtime connection: the same role the API uses. */
export const runtime = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

export const PASSWORD = 'correct horse battery staple';
let passwordHash: string | undefined;

export async function resetDatabase() {
  await owner.$executeRawUnsafe(
    'TRUNCATE audit_events, items, sessions, login_attempts, users, organizations RESTART IDENTITY CASCADE',
  );
}

export interface Fixture {
  orgA: string;
  orgB: string;
  users: Record<'managerA' | 'manager2A' | 'memberA' | 'member2A' | 'managerB' | 'memberB', { id: string; email: string; role: Role; orgId: string }>;
}

/** Two orgs; A has two managers and two members, B has one of each. */
export async function seedFixture(): Promise<Fixture> {
  passwordHash ??= await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const orgA = (await owner.organization.create({ data: { name: 'Org A' } })).id;
  const orgB = (await owner.organization.create({ data: { name: 'Org B' } })).id;
  const mk = async (email: string, role: Role, orgId: string) => {
    const u = await owner.user.create({ data: { email, name: email.split('@')[0], role, orgId, passwordHash: passwordHash! } });
    return { id: u.id, email, role, orgId };
  };
  return {
    orgA,
    orgB,
    users: {
      managerA: await mk('manager.a@test.dev', 'MANAGER', orgA),
      manager2A: await mk('manager2.a@test.dev', 'MANAGER', orgA),
      memberA: await mk('member.a@test.dev', 'MEMBER', orgA),
      member2A: await mk('member2.a@test.dev', 'MEMBER', orgA),
      managerB: await mk('manager.b@test.dev', 'MANAGER', orgB),
      memberB: await mk('member.b@test.dev', 'MEMBER', orgB),
    },
  };
}

export async function createItem(
  orgId: string,
  data: { assigneeId: string; createdById: string; status?: ItemStatus; dueDate?: string; title?: string; version?: number },
) {
  return inOrgTransaction(owner, orgId, (tx) =>
    tx.item.create({
      data: {
        orgId,
        title: data.title ?? 'Rotate leaked key',
        description: 'Rotate it.',
        assigneeId: data.assigneeId,
        createdById: data.createdById,
        status: data.status ?? 'OPEN',
        version: data.version ?? 1,
        dueDate: new Date(`${data.dueDate ?? '2099-01-01'}T00:00:00Z`),
      },
    }),
  );
}
