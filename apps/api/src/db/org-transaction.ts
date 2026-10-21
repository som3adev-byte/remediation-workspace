import type { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside one interactive transaction with Postgres' `app.org_id` set for
 * that transaction only. Row-level security on items and audit_events reads this
 * setting, so every query that touches those tables must use the `tx` passed in here,
 * never the global client: a query on another connection would not see the setting
 * and would match no rows (fail closed).
 *
 * Used by the API (via withActor), the seed and the test fixtures.
 */
export async function inOrgTransaction<T>(
  prisma: PrismaClient,
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      // Parameterized: orgId is sent as a bind value, never interpolated into SQL.
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      return fn(tx);
    },
    { maxWait: 2_000, timeout: 5_000 },
  );
}
