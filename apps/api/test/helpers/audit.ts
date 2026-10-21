import { owner } from './db';

/** Reads an item and its audit rows straight from the database (as the owner, inside the org). */
export function persisted(orgId: string, itemId: string) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
    const audit = await tx.auditEvent.findMany({ where: { itemId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { item, audit, actions: audit.map((a) => a.action) };
  });
}
