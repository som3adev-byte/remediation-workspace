import { Inject, Injectable } from '@nestjs/common';
import type { AuditAction, Item, Prisma } from '@prisma/client';
import { EDITABLE_STATUSES, LIMITS, type CreateItemInput, type ListQuery, type UpdateItemInput } from '@rw/shared';
import type { Actor } from '../common/request-context';
import { Errors } from '../common/errors';
import type { Tx } from '../db/org-transaction';
import { PrismaService } from '../db/prisma.service';
import { fromDateString, itemScope, toDateString, todayUtc, withActor } from './scope';

const itemSelect = {
  id: true,
  ref: true,
  title: true,
  description: true,
  status: true,
  dueDate: true,
  completionNote: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ItemSelect;

type SelectedItem = Prisma.ItemGetPayload<{ select: typeof itemSelect }>;

function present(item: SelectedItem, today: Date) {
  return {
    ...item,
    dueDate: toDateString(item.dueDate),
    overdue: item.status !== 'CLOSED' && item.dueDate < today,
  };
}

@Injectable()
export class ItemsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Inbox: scope + filters, bounded page, stable order (due date, then id). Count uses the same WHERE. */
  async list(actor: Actor, q: ListQuery) {
    return withActor(this.prisma, actor, async (tx) => {
      const today = await todayUtc(tx);
      const where: Prisma.ItemWhereInput = {
        ...itemScope(actor),
        ...(q.status && { status: q.status }),
        ...(q.overdue && { dueDate: { lt: today }, status: q.status ?? { not: 'CLOSED' } }),
      };
      // Asking for overdue + Closed can never match (closed items are never overdue).
      if (q.overdue && q.status === 'CLOSED') {
        return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
      }
      const [rows, total] = await Promise.all([
        tx.item.findMany({
          where,
          select: itemSelect,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.item.count({ where }),
      ]);
      return { items: rows.map((r) => present(r, today)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(actor: Actor, id: string) {
    return withActor(this.prisma, actor, async (tx) => {
      const item = await tx.item.findFirst({ where: { id, ...itemScope(actor) }, select: itemSelect });
      if (!item) throw Errors.notFound();
      return present(item, await todayUtc(tx));
    });
  }

  /** Newest first, capped. The parent item must be visible to the actor first. */
  async activity(actor: Actor, id: string) {
    return withActor(this.prisma, actor, async (tx) => {
      const visible = await tx.item.findFirst({ where: { id, ...itemScope(actor) }, select: { id: true } });
      if (!visible) throw Errors.notFound();
      return tx.auditEvent.findMany({
        where: { itemId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIMITS.activityMax,
        select: { id: true, action: true, changes: true, createdAt: true, actor: { select: { id: true, name: true } } },
      });
    });
  }

  /** People a manager can assign: active users in the manager's own organization. */
  async assignees(actor: Actor) {
    if (actor.role !== 'MANAGER') throw Errors.forbidden();
    return this.prisma.user.findMany({
      where: { orgId: actor.orgId, disabledAt: null },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async create(actor: Actor, input: CreateItemInput) {
    if (actor.role !== 'MANAGER') throw Errors.forbidden();
    return withActor(this.prisma, actor, async (tx) => {
      await this.assertAssignable(tx, actor, input.assigneeId);
      const item = await tx.item.create({
        data: {
          orgId: actor.orgId, // from the session, never from the request
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          dueDate: fromDateString(input.dueDate),
          createdById: actor.userId,
        },
        select: itemSelect,
      });
      await this.audit(tx, actor, item.id, 'CREATED', {
        title: input.title,
        assigneeId: input.assigneeId,
        dueDate: input.dueDate,
      });
      return present(item, await todayUtc(tx));
    });
  }

  /**
   * Edit and reassign. One guarded UPDATE carries every condition, so the check and the
   * write are atomic: same org, the version the client saw, and an editable status.
   * If it matches no row nothing is written (no audit row either) and we explain why.
   */
  async update(actor: Actor, id: string, input: UpdateItemInput) {
    return withActor(this.prisma, actor, async (tx) => {
      const current = await tx.item.findFirst({ where: { id, ...itemScope(actor) } });
      if (!current) throw Errors.notFound();
      if (actor.role !== 'MANAGER') throw Errors.forbidden();

      const reassigning = input.assigneeId !== undefined && input.assigneeId !== current.assigneeId;
      if (reassigning) await this.assertAssignable(tx, actor, input.assigneeId!);

      const data: Prisma.ItemUpdateManyMutationInput & { assigneeId?: string } = { version: { increment: 1 } };
      const edits: Record<string, { from: unknown; to: unknown }> = {};
      if (input.title !== undefined && input.title !== current.title) {
        data.title = input.title;
        edits.title = { from: current.title, to: input.title };
      }
      if (input.description !== undefined && input.description !== current.description) {
        data.description = input.description;
        edits.description = { from: current.description, to: input.description };
      }
      if (input.dueDate !== undefined && input.dueDate !== toDateString(current.dueDate)) {
        data.dueDate = fromDateString(input.dueDate);
        edits.dueDate = { from: toDateString(current.dueDate), to: input.dueDate };
      }
      if (reassigning) data.assigneeId = input.assigneeId;

      const result = await tx.item.updateMany({
        where: {
          id,
          orgId: actor.orgId,
          version: input.version,
          status: { in: [...EDITABLE_STATUSES] },
        },
        data,
      });
      if (result.count !== 1) throw this.explainUpdateMiss(current, input.version);

      if (Object.keys(edits).length > 0) await this.audit(tx, actor, id, 'EDITED', edits as Prisma.InputJsonValue);
      if (reassigning) {
        await this.audit(tx, actor, id, 'REASSIGNED', {
          assigneeId: { from: current.assigneeId, to: input.assigneeId },
        });
      }
      const updated = await tx.item.findFirstOrThrow({ where: { id, ...itemScope(actor) }, select: itemSelect });
      return present(updated, await todayUtc(tx));
    });
  }

  /** Why a guarded update matched no row, using the state we read before it. */
  private explainUpdateMiss(current: Item, clientVersion: number) {
    if (!EDITABLE_STATUSES.includes(current.status)) return Errors.invalidTransition();
    if (current.version !== clientVersion) return Errors.conflict();
    // The row changed between our read and our write (a concurrent request won).
    return Errors.conflict();
  }

  /** The assignee must be an active user in the actor's organization. */
  private async assertAssignable(tx: Tx, actor: Actor, assigneeId: string) {
    const user = await tx.user.findFirst({
      where: { id: assigneeId, orgId: actor.orgId, disabledAt: null },
      select: { id: true },
    });
    if (!user) throw Errors.invalidAssignee();
  }

  /** Audit rows are written only here, in the same transaction as the change they describe. */
  async audit(tx: Tx, actor: Actor, itemId: string, action: AuditAction, changes: Prisma.InputJsonValue) {
    await tx.auditEvent.create({ data: { orgId: actor.orgId, itemId, actorId: actor.userId, action, changes } });
  }
}
