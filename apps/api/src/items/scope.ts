import type { Prisma } from '@prisma/client';
import type { Actor } from '../common/request-context';
import { inOrgTransaction, type Tx } from '../db/org-transaction';
import type { PrismaService } from '../db/prisma.service';

/**
 * The single definition of "which items can this person see". Used by the list, the
 * count, the detail view, the activity history and every mutation's WHERE clause.
 *   manager: every item in their organization
 *   member:  only items currently assigned to them in their organization
 * Reassigning an item changes assigneeId, so the previous member's very next request no
 * longer matches: access is removed immediately, with no cache to expire.
 */
export function itemScope(actor: Actor): Prisma.ItemWhereInput {
  return actor.role === 'MANAGER'
    ? { orgId: actor.orgId }
    : { orgId: actor.orgId, assigneeId: actor.userId };
}

/**
 * Runs `fn` in a transaction scoped to the actor's organization (row-level security).
 * Two independent layers: itemScope() in the query, and the database policy behind it.
 */
export function withActor<T>(prisma: PrismaService, actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inOrgTransaction(prisma, actor.orgId, fn);
}

/** Today's calendar date in UTC, from the database clock (overdue = due_date < this). */
export async function todayUtc(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<{ today: Date }[]>`SELECT (now() AT TIME ZONE 'UTC')::date AS today`;
  return rows[0].today;
}

export const toDateString = (d: Date) => d.toISOString().slice(0, 10);
export const fromDateString = (s: string) => new Date(`${s}T00:00:00Z`);
