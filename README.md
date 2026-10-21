# Secure Remediation Workspace

Organizations assign remediation work, track progress and approve completion.

> Work in progress. Setup, demo accounts, test commands, architecture, limitations and the hand-off note are added as each phase lands.

## Time log

Times are local (UTC+3). The brief caps the work at 8 hours including documentation; actual time is reported here as it happens.

| Start | End | Phase | Notes |
|-------|-----|-------|-------|
| 2026-10-21 09:52 | 10:02 | Foundation | monorepo, Postgres roles, Prisma schema + RLS, shared package, seed, test harness (RLS tests green). Lost ~3 min to a local Docker disk error and a host Postgres already on port 5432 (moved to 55432). |
| 2026-10-21 10:02 | 10:11 | Auth | login/logout, JWT verify (alg, iss, aud, exp), server sessions with revocation, disabled users, throttling, Origin + proxy-secret guards, error filter, redacted logs. 35 API tests green. |
| 2026-10-21 10:11 | 10:14 | Items | list (status/overdue filters, bounded pages, stable sort, scoped count), detail, activity, create, edit, reassign; one scope function + RLS; guarded single UPDATE with version; org-scoped active assignee (422); audit rows in the same transaction. 52 API tests green. |
