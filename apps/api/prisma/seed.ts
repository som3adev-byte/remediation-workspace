// Repeatable demo data: wipes the app tables, then creates two organizations, each with
// two managers and two members, and a spread of items in every status (some overdue).
// Runs as app_owner (MIGRATION_DATABASE_URL). Items and audit rows are written through
// inOrgTransaction because FORCE ROW LEVEL SECURITY applies to the table owner too.
import { PrismaClient, type AuditAction, type ItemStatus } from '@prisma/client';
import argon2 from 'argon2';
import { inOrgTransaction } from '../src/db/org-transaction';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });

const SEED_PASSWORD = process.env.SEED_PASSWORD;
if (!SEED_PASSWORD || SEED_PASSWORD.length < 8) {
  throw new Error('SEED_PASSWORD must be set in .env (8+ characters).');
}

/** Calendar date `days` from today in UTC, as a Date at 00:00Z (Prisma @db.Date). */
function dayOffset(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

interface ItemSpec {
  title: string;
  description: string;
  assignee: string; // email
  dueInDays: number;
  status: ItemStatus;
  completionNote?: string;
}

const ORGS = [
  {
    name: 'Acme Security',
    users: [
      { email: 'dana@acme.test', name: 'Dana Reyes', role: 'MANAGER' as const },
      { email: 'omar@acme.test', name: 'Omar Haddad', role: 'MANAGER' as const },
      { email: 'sam@acme.test', name: 'Sam Patel', role: 'MEMBER' as const },
      { email: 'lee@acme.test', name: 'Lee Wong', role: 'MEMBER' as const },
    ],
    items: [
      { title: 'Patch OpenSSL on edge proxies', description: 'Edge proxies run OpenSSL 1.1.1, which is out of support. Upgrade to a supported 3.0.x release on every edge node and confirm with a TLS scan.', assignee: 'sam@acme.test', dueInDays: -3, status: 'PENDING_REVIEW', completionNote: 'Upgraded to 3.0.15 on all 12 edge nodes, verified with openssl version and a TLS scan.' },
      { title: 'Rotate leaked API key in billing service', description: 'A billing API key was committed to a public repository. Rotate it and invalidate the old key.', assignee: 'lee@acme.test', dueInDays: -1, status: 'OPEN' },
      { title: 'Enable MFA for admin accounts', description: 'Require a second factor for every account with admin rights in the identity provider.', assignee: 'sam@acme.test', dueInDays: 4, status: 'IN_PROGRESS' },
      { title: 'Remove public read on S3 bucket logs-prod', description: 'The logs-prod bucket allows public reads. Remove the public grant and confirm access logging still works.', assignee: 'lee@acme.test', dueInDays: 7, status: 'OPEN' },
      { title: 'Upgrade lodash to fix prototype pollution', description: 'Bump lodash to a patched version in the web and worker services.', assignee: 'sam@acme.test', dueInDays: 10, status: 'OPEN' },
      { title: 'Restrict SSH to bastion host', description: 'Allow SSH to application servers only from the bastion host security group.', assignee: 'omar@acme.test', dueInDays: 12, status: 'IN_PROGRESS' },
      { title: 'Review IAM role for CI deploys', description: 'The CI deploy role has wildcard permissions. Reduce it to the actions the pipeline uses.', assignee: 'lee@acme.test', dueInDays: -10, status: 'CLOSED', completionNote: 'Replaced the wildcard policy with 9 explicit actions; deploy pipeline green.' },
      { title: 'Fix stored XSS in comments widget', description: 'User comments render unescaped HTML. Escape output and add a CSP header.', assignee: 'sam@acme.test', dueInDays: 15, status: 'OPEN' },
    ] satisfies ItemSpec[],
  },
  {
    name: 'Globex Defense',
    users: [
      { email: 'nina@globex.test', name: 'Nina Diaz', role: 'MANAGER' as const },
      { email: 'raj@globex.test', name: 'Raj Mehta', role: 'MANAGER' as const },
      { email: 'alex@globex.test', name: 'Alex Kim', role: 'MEMBER' as const },
      { email: 'maya@globex.test', name: 'Maya Chen', role: 'MEMBER' as const },
    ],
    items: [
      { title: 'Disable TLS 1.0 on the payments gateway', description: 'The payments gateway still accepts TLS 1.0. Require TLS 1.2 or newer.', assignee: 'alex@globex.test', dueInDays: -2, status: 'IN_PROGRESS' },
      { title: 'Rotate database credentials after contractor offboarding', description: 'A contractor with database access left. Rotate the shared credentials and update secrets.', assignee: 'maya@globex.test', dueInDays: 3, status: 'OPEN' },
      { title: 'Apply kernel updates on bastions', description: 'Bastion hosts are two kernel releases behind. Patch and reboot during the maintenance window.', assignee: 'alex@globex.test', dueInDays: 6, status: 'PENDING_REVIEW', completionNote: 'Patched both bastions to the latest kernel and rebooted in the Sunday window.' },
      { title: 'Turn on audit logging for the admin console', description: 'Admin console actions are not logged. Enable audit logging and ship logs to the SIEM.', assignee: 'maya@globex.test', dueInDays: 9, status: 'OPEN' },
    ] satisfies ItemSpec[],
  },
];

const STATUS_HISTORY: Record<ItemStatus, AuditAction[]> = {
  OPEN: [],
  IN_PROGRESS: ['STARTED'],
  PENDING_REVIEW: ['STARTED', 'SUBMITTED'],
  CLOSED: ['STARTED', 'SUBMITTED', 'APPROVED'],
};
const STATUS_VERSION: Record<ItemStatus, number> = { OPEN: 1, IN_PROGRESS: 2, PENDING_REVIEW: 3, CLOSED: 4 };

async function main() {
  // TRUNCATE is not subject to row-level security; the owner can always reset.
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_events, items, sessions, login_attempts, users, organizations RESTART IDENTITY CASCADE',
  );

  const passwordHash = await argon2.hash(SEED_PASSWORD!, { type: argon2.argon2id });

  for (const orgSpec of ORGS) {
    const org = await prisma.organization.create({ data: { name: orgSpec.name } });
    const users = new Map<string, string>();
    for (const u of orgSpec.users) {
      const user = await prisma.user.create({
        data: { orgId: org.id, email: u.email, name: u.name, role: u.role, passwordHash },
      });
      users.set(u.email, user.id);
    }
    const manager = users.get(orgSpec.users[0].email)!;
    const reviewer = users.get(orgSpec.users[1].email)!;

    await inOrgTransaction(prisma, org.id, async (tx) => {
      for (const spec of orgSpec.items) {
        const assigneeId = users.get(spec.assignee)!;
        const item = await tx.item.create({
          data: {
            orgId: org.id,
            title: spec.title,
            description: spec.description,
            assigneeId,
            dueDate: dayOffset(spec.dueInDays),
            status: spec.status,
            completionNote: spec.completionNote ?? null,
            version: STATUS_VERSION[spec.status],
            createdById: manager,
          },
        });
        await tx.auditEvent.create({
          data: { orgId: org.id, itemId: item.id, actorId: manager, action: 'CREATED', changes: { title: spec.title } },
        });
        for (const action of STATUS_HISTORY[spec.status]) {
          const actorId = action === 'APPROVED' ? reviewer : assigneeId;
          const changes = action === 'SUBMITTED' ? { completionNote: spec.completionNote } : {};
          await tx.auditEvent.create({ data: { orgId: org.id, itemId: item.id, actorId, action, changes } });
        }
      }
    });
  }

  const counts = await prisma.$queryRaw<{ orgs: bigint; users: bigint }[]>`
    SELECT (SELECT count(*) FROM organizations) AS orgs, (SELECT count(*) FROM users) AS users`;
  console.log(`Seeded ${counts[0].orgs} organizations and ${counts[0].users} users.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
