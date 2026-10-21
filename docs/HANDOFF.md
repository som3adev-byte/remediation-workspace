# Handoff

For the next engineer. Read the README's quick start and session lifecycle first; this file covers what isn't obvious from the code.

## Where things are

| You want to… | Look at |
|---|---|
| Change who can see which items | `apps/api/src/items/scope.ts` (`itemScope`). Every list, count, detail, history and mutation goes through it. |
| Change a workflow rule | `packages/shared/src/index.ts` (`TRANSITIONS`) for the table both apps read, then `ItemsService.transition` for the guarded UPDATE. |
| Change request validation or limits | `packages/shared/src/index.ts` (zod schemas, `LIMITS`). The API and the form both use them. |
| Change the session or cookie | `apps/api/src/auth/` (`tokens.ts`, `auth.service.ts`, `cookies.ts`, `config/env.ts` → `AUTH`). |
| Change what the browser can reach | `apps/web/app/api/[...path]/route.ts` (the proxy) and the three global guards in `apps/api/src/app.module.ts`. |
| Change the database | A new Prisma migration in `apps/api/prisma/migrations/`. See "Database changes" below. |
| Change the look | `DESIGN.md` first, then `apps/web/app/globals.css` (tokens at the top). |

## How one request flows (approve)

1. The browser POSTs `/api/items/:id/transitions/approve` with `{version}` to its own origin. The cookie goes along.
2. The Next proxy forwards it to `127.0.0.1:4000/items/:id/transitions/approve`: same `Origin`, its own `X-Forwarded-For`, plus `X-Internal-Proxy-Secret`.
3. NestJS guards run in order: proxy secret → Origin → auth (JWT, then the session row and the user in the database). `req.actor` is set from the database row.
4. The controller checks the action name, then validates the body with `approveSchema` (`.strict()`).
5. `ItemsService.transition` opens a transaction with `app.org_id` set (RLS), runs one guarded UPDATE, and inserts the audit row in the same transaction. If the UPDATE matched nothing, it re-reads the item to choose 404, 403 or 409.
6. Errors become `{code, message, requestId}` in `common/exception.filter.ts`. The access log writes one line with the request id.
7. The web app shows a toast, updates the badge, refreshes Activity, and tells the inbox and the sidebar count to reload.

## Rules that keep it safe

- **Items and audit queries must use the `tx` from `withActor(...)`**, never the global Prisma client. Outside that transaction, RLS shows zero rows, so a mistake fails closed, but it shows up as empty lists, not as an error.
- **Put permission rules in the UPDATE's WHERE**, not only in an `if` before it. The tests and the guard-removal check in the README depend on that.
- **Every mutation takes the client's `version`** and increments it.
- **New request bodies get a `.strict()` schema** in `packages/shared`. Never read `orgId`, `actorId` or `role` from a request.
- **Answer 404 for anything outside the actor's scope**, including malformed ids (`ItemIdPipe`).
- **Don't log bodies, notes, titles, cookies or tokens.** Log ids and the request id.

## Gotchas

- **Rebuild `packages/shared` after changing it** (`pnpm build:shared`). The root `dev`, `test` and `typecheck` scripts do it for you; running an app's script directly does not.
- **NestJS constructors use explicit `@Inject(Class)`.** Vitest compiles with esbuild, which doesn't emit decorator metadata, so implicit injection breaks only in tests.
- **The seed and test fixtures run as the owner role, but RLS is `FORCE`d,** so they also set `app.org_id` (`inOrgTransaction`) when writing items and audit rows.
- **Two database roles.** `app_owner` runs migrations, seed and test resets. `app_user` is the runtime role (no ownership, no `BYPASSRLS`, no `DELETE` on items, append-only audit). Default privileges grant `app_user` SELECT/INSERT/UPDATE on new tables; anything else must be granted in the migration.
- **Ports:** Postgres 55432, API 4000 (loopback only), web 3100.
- **`docker compose` vs `docker-compose`:** both work; older installs only have the second.
- **A browser extension** that edits `<html>` attributes causes a hydration warning; `suppressHydrationWarning` on `<html>` covers only that tag.

## Database changes

1. `pnpm --filter @rw/api db:migrate:dev` to create a migration from `schema.prisma`, then read the generated SQL.
2. New org-scoped table? Add `ENABLE` + `FORCE ROW LEVEL SECURITY` and per-command policies in the same migration, and a test like `apps/api/test/rls.spec.ts`.
3. Check grants: the runtime role should get exactly what it needs.
4. For anything that touches existing data, use expand → migrate → contract (Architecture note §7).
5. `pnpm db:setup:test && pnpm test` before committing.

## Open items

The README's "Known limitations" and "Next three priorities" are the honest list of what is missing. The most important:
- The per-IP login counter is shared behind the local proxy. Production needs the load balancer's client IP.
- The Content-Security-Policy still allows inline scripts. A per-request nonce would remove that.
- There are no automated browser end-to-end tests. The main flows were checked by hand.
- A full third-party scan (Strix) with an API key. The subscription run was stopped by the provider's guardrails before its active phase.
