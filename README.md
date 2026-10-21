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
| 2026-10-21 10:14 | 10:20 | Workflow | four transitions as one guarded UPDATE each (org, version, status, assignee rule); 404/403/409 explained after a miss; completion note kept on request-changes, reason in the audit row; tests 7 and 8 incl. concurrent approvals; guard-removal check. 65 API tests green. |
| 2026-10-21 10:20 | 10:35 | UI | Next.js proxy route, login, inbox split view with filters/pagination/all states, detail with actions and activity, item form with 409 banner and draft restore, session-expired dialog, responsive layouts. Web dev port moved to 3100 (3000 was taken locally). 87 tests green (65 API + 22 web). |

## Do the tests catch regressions?

Each guard was removed on its own, the suite was run, and the guard was restored (the suite is green again afterwards).

| Guard removed | Result |
|---|---|
| `assigneeId = actor` on start/submit | 1 failure: `items.same-org` "only the assignee can start or submit" |
| `version` in the guarded UPDATEs (edit + transitions) | 3 failures in `concurrency`: stale edit, stale edit after a transition, stale-view approve after resubmit |
| `orgId` in the items scope | **0 failures**: row-level security still returned only the actor's org, so every cross-org test stayed green |
| Row-level security disabled, scope intact | 4 failures, all in `rls.spec`; every API test stayed green |
| Row-level security disabled **and** `orgId` removed | 8 failures: the 4 above plus list/count, detail/history, edit/reassign and transitions in `items.cross-org` |

The third row is the expected result of two independent layers: either one alone keeps organizations apart, and the suite fails only when both are gone. The concurrent-approval test still passes without `version` because the `status = PENDING_REVIEW` condition also stops the second approval; the stale-view test is the one that needs `version`.
