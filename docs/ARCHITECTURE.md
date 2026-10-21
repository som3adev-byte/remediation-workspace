# Architecture note

## 1. Structure and data model

```
apps/web         Next.js 15 (App Router), client components only. Talks to one URL: /api/* on its own origin.
  app/api/[...path]/route.ts   the proxy to the API (the only server-side code in the web app)
  components/                  inbox, item detail, item form, shell, small UI primitives
  lib/                         fetch wrapper, drafts, safe redirect, formatting
apps/api         NestJS 11 on Express, Prisma 6, PostgreSQL 16
  src/auth/                    login, logout, token verify, sessions, throttling, guards
  src/items/                   scope, list/detail/activity, create/edit/reassign, workflow transitions
  src/common/                  errors, error filter, request id + access log, validation pipe, origin/proxy guards
  prisma/                      schema, 3 migrations (tables, RLS policies + grants, least privilege), seed
packages/shared  zod request schemas (.strict()), the transition table, limits, labels. Used by both apps.
```

```
Browser ──(HttpOnly cookie, same origin)──> Next.js /api/[...path] ──(X-Internal-Proxy-Secret)──> NestJS on 127.0.0.1:4000 ──> Postgres
                                                                                                       as app_user (RLS applies)
```

**Data model**

| Table | Key columns | Notes |
|---|---|---|
| `organizations` | id, name | |
| `users` | id, org_id, email (unique), name, role `MANAGER/MEMBER`, password_hash (argon2id), disabled_at | One user, one org. |
| `sessions` | id, user_id, expires_at, revoked_at | One row per sign-in. Checked on every request. |
| `items` | id, ref (display number), org_id, title, description, assignee_id, due_date `DATE`, status, completion_note, version, created_by_id, timestamps | `version` is the optimistic-concurrency counter. |
| `audit_events` | id, org_id, item_id, actor_id, action, changes `jsonb`, created_at | Append-only for the runtime role. |
| `login_attempts` | email_key, ip, created_at | Failed sign-ins inside the throttle window. |

**Due dates are calendar dates** (`DATE`, `YYYY-MM-DD`), not timestamps. An item is overdue when `due_date < today in UTC` and status is not Closed; "today" comes from the database clock. The UI shows the date string as stored, with no timezone conversion.

## 2. Authentication, tokens, revocation, authorization

**Sign-in.** `POST /auth/login` validates the body, checks the throttle, loads the user by normalized email and verifies the password with argon2id. An unknown email still runs a verify against a dummy hash, so timing and the response (`401 invalid_credentials`) are the same for "no such account", "wrong password" and "disabled account". On success a `sessions` row is created and a JWT is set as a cookie.

**Token.** HS256 JWT signed with `jose`: `sub` (user id), `sid` (session id), `iss`, `aud`, `iat`, `exp`. Lifetime 15 minutes, never beyond the session's 8-hour cap. Verification pins `algorithms: ['HS256']` and checks issuer, audience, expiry and required claims. `alg: none`, tampered, malformed, expired, wrong-issuer and wrong-audience tokens all get `401`.

**Where the token lives.** In a cookie `rw_session` that is `HttpOnly` (page scripts, including injected ones, cannot read it), `SameSite=Strict` (other sites cannot make the browser send it) and `Secure` outside local HTTP. The browser only talks to its own origin, so the cookie never needs to cross origins and the API needs no CORS. On top of SameSite, every state-changing request must carry `Origin` equal to `WEB_ORIGIN` or it gets `403 origin_rejected`. Nothing is kept in `localStorage`.

**Every authenticated request** (`AuthGuard`): verify the JWT, then load the session row and the user in one query. The request fails with `401 session_expired` if the session is revoked or past its cap, or the user is disabled. Identity, org and role come only from that database row, never from the request. After 10 minutes a fresh 15-minute token is issued on the response (capped at the session end), so an active user is never interrupted, and an idle tab expires after 15 minutes.

**Logout** sets `revoked_at` on the session and clears the cookie. A copy of the old token is useless from then on, because the session check fails, even though the token's signature and `exp` are still valid. Disabling a user works the same way: the next request fails.

**Throttling.** 5 failures per email and 20 per IP in 15 minutes. The email key counts whether or not the account exists, so the limit does not reveal accounts. Every throttled answer is the same `429`. Each attempt records its row before it counts, so a burst of parallel requests cannot slip past the limit.

**Authorization boundaries, from outside in:**

1. `ProxySecretGuard`: the API listens on 127.0.0.1 and rejects any request without the proxy's shared secret, so `X-Forwarded-For` and `Origin` can only come through the proxy.
2. `OriginGuard`: writes must come from the web origin.
3. `AuthGuard`: who is calling (above).
4. **Item scope** (`items/scope.ts`): one function returns the WHERE for "items this actor may see". Manager: `org_id = actor.org`. Member: `org_id = actor.org AND assignee_id = actor.id`. The list, the count, the detail, the activity history and every mutation use it. Out of scope always answers `404`, so ids from other orgs reveal nothing.
5. **Mutation guards inside the UPDATE** (below): role, assignee and status rules are conditions of the write itself.
6. **Row-level security**: every items and audit query runs in a transaction that sets `app.org_id`. Postgres policies (`ENABLE` + `FORCE`) hide rows from other orgs. Without the setting, no rows are visible. The runtime role `app_user` owns no tables, cannot bypass RLS, cannot delete items, and cannot update or delete audit rows.

Layers 4 and 6 are independent. The README's guard-removal table shows that removing either one alone keeps every cross-org test green, and removing both makes them fail.

**Writable fields.** Every request body is parsed with a `.strict()` zod schema. Unknown keys such as `orgId`, `status`, `version` on create, `actorId` or `createdById` are rejected with `400` and named in the response. `org_id`, `created_by_id` and audit actors come from the session. Status changes only through the four transition endpoints.

## 3. Concurrency and audit consistency

Each mutation is **one transaction** containing **one guarded UPDATE** plus its audit insert:

```sql
UPDATE items SET status = 'CLOSED', version = version + 1
WHERE id = $id AND org_id = $actorOrg AND version = $clientVersion
  AND status = 'PENDING_REVIEW' AND assignee_id <> $actor      -- approve
```

- The client sends the `version` it rendered. Edits, reassignments and all four transitions require it.
- If the UPDATE matches one row, the audit row is inserted in the same transaction. Either both commit or neither does.
- If it matches nothing, the service re-reads the item in scope to explain why: `404` not visible, `403` wrong actor, `409 invalid_transition` wrong status, `409 conflict` stale version. Nothing is written.
- **Two managers approving at once:** both send version N. Postgres locks the row for the first, and re-checks the second's WHERE after the first commits. The second now sees version N+1, matches nothing and gets `409`. Result: one `200`, one `409`, one audit row. This runs 5 times per test run in `concurrency.spec.ts`.
- **Stale view after a round trip** (request changes, then resubmit): the status is `PENDING_REVIEW` again, but the version moved on twice, so an approval from the old view gets `409`.

The audit row records actor, timestamp, action and changes: `{field: {from, to}}` for edits, assignee id and name snapshots for reassignments, the completion note for submit, the reason for request-changes. History is read only after the parent item passes the actor's scope, newest first, at most 100 rows.

## 4. Indexes and the queries they serve

| Index | Query |
|---|---|
| `items (org_id, status, due_date, id)` | Manager inbox filtered by status, ordered by due date then id. Overdue (`due_date < today`) is a range on the same index. Count uses the same WHERE. |
| `items (org_id, assignee_id, status, due_date, id)` | Member inbox: the same queries narrowed to one assignee. |
| `items.ref` unique | Display reference. |
| `audit_events (org_id, item_id, created_at)` | Activity history for one item, newest first. |
| `sessions (user_id)` + primary key | Session check on every request (primary key); per-user lookups. |
| `users.email` unique, `users (org_id, role)` | Sign-in lookup; assignee list for a manager's org. |
| `login_attempts (email_key, created_at)`, `(ip, created_at)` | Throttle counts inside the window. |

A manager's "All statuses" view sorts across statuses. At seed and test size this is an in-memory sort of one org's rows. At larger sizes, `items (org_id, due_date, id)` would serve it directly (section 5).

## 5. Growing to 500 orgs, 5 million items, bursts of 100 updates/second

**Assumptions:** about 10,000 items per org on average, a few orgs 10 to 50 times larger. Reads outnumber writes. A burst of 100 updates/second spreads across many orgs and items, not one hot row.

**What one Postgres already handles.** 5 million rows with the indexes above is a modest table. 100 short single-row transactions per second is low for Postgres if each stays a few milliseconds. The design keeps them short: one UPDATE, one INSERT, no locks held across network calls.

**What to measure first, before adding anything:**
- p95/p99 latency per endpoint, and DB time per query (`pg_stat_statements`).
- Connection pool wait time, transactions per second, lock waits and deadlocks.
- How often `409 conflict` happens, by endpoint (contention signal).
- Inbox query plans for the largest orgs (`EXPLAIN ANALYZE`), especially deep pages and counts.
- Session-check cost per request, since it is one query on every call.

**Likely changes, in the order I would expect to need them:**
1. **Connection pooling** (PgBouncer in transaction mode). `SET LOCAL`/`set_config(..., true)` is transaction-scoped, so RLS keeps working with transaction pooling.
2. **Keyset pagination** (`WHERE (due_date, id) > ($last)`) instead of OFFSET for deep pages. Cap or estimate counts for very large orgs, or cache them briefly.
3. **An index for the unfiltered manager sort** `(org_id, due_date, id)`, added only if plans show sorts on large orgs.
4. **A read replica** for inbox and history reads, if the primary is CPU-bound by reads. Writes and the session check stay on the primary.
5. **Several API instances** behind a load balancer. The API is stateless apart from Postgres. The per-IP login limit then needs the real client IP from the balancer (see Known limitations in the README).
6. **Partition `audit_events`** by time if it grows much faster than items. It is append-only, so this is easy.

Sharding by org is not needed at this size; `org_id` leads every index, so it stays possible later.

## 6. Investigating failures without logging sensitive data

- Every request gets an id (`req_…`), returned in `X-Request-Id` and in every error body. The UI shows it on failure banners, so a user can quote it.
- One structured JSON access-log line per request: request id, method, path, status, duration, user id and org id. **Never** bodies, cookies, tokens, passwords or headers. pino redaction is configured for those fields as a second safeguard.
- Item titles, descriptions, notes and reasons are customer data and are not logged. Ids are enough to find the row, and access to the database itself is controlled.
- `5xx` errors log the stack trace server-side with the request id. The client only gets `{code, message, requestId}`. Database outages map to `503`.
- With the request id you can find the access line, the error line, and then the audit rows for the item to reconstruct what happened.
- Next step for production: add metrics (rates, latency, 409/429/5xx counts) and tracing with the same request id.

## 7. Introducing a database change safely

Use expand, migrate, contract, with each step deployable on its own:

1. **Expand.** Add the new column or table in a migration that the running code ignores: nullable or with a default, and `CREATE INDEX CONCURRENTLY` for big tables. Grant the runtime role exactly what it needs. If it is a new org-scoped table, add its RLS policy in the same migration.
2. **Deploy code that writes both** the old and new shape, and reads the old one.
3. **Backfill** in small batches, outside peak, and check counts.
4. **Switch reads** to the new shape behind a flag; watch errors and latency.
5. **Contract.** Drop the old column in a later release, once nothing reads it.

Rules: migrations are reviewed SQL (`prisma migrate`), run by the owner role, tested on a copy of production-sized data for lock time, with a `lock_timeout` set so a blocked migration fails fast instead of queuing every request behind it. Every new org-scoped table gets an RLS test like `apps/api/test/rls.spec.ts`.
