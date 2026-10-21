# Secure Remediation Workspace

Organizations assign security remediation work to their people, track progress, and approve completion. Managers create, assign and review items; members start work and submit it. Every rule is enforced on the server and backed by row-level security in Postgres.

**Stack:** TypeScript · Next.js 15 (web) · NestJS 11 on Express (API) · Prisma 6 · PostgreSQL 16 · Vitest.

- [Architecture note](docs/ARCHITECTURE.md): structure, auth, authorization, concurrency, indexes, scaling, operations.
- [Handoff for the next engineer](docs/HANDOFF.md)
- [Test matrix](docs/TEST_MATRIX.md): each of the brief's nine required tests mapped to its file.
- [Design system](DESIGN.md)

## Quick start

Requirements: Node 20+, pnpm (`corepack enable` picks the version pinned in `package.json`), Docker (Docker Desktop or Colima).

```bash
cp .env.example .env              # works as-is for local use; replace the secrets for anything else
docker compose up -d --wait       # Postgres 16 on localhost:55432; waits until roles and databases exist
                                  # (older installs: docker-compose up -d --wait)
pnpm install
pnpm db:setup                     # migrate + seed the dev database
pnpm db:setup:test                # migrate the test database
pnpm dev                          # API on 127.0.0.1:4000, web on http://localhost:3100
```

Open http://localhost:3100.

Ports are deliberately unusual (55432, 3100) so the project doesn't collide with a local Postgres on 5432 or another app on 3000. To use different ports, change `docker-compose.yml`, `.env` (`*_DATABASE_URL`, `WEB_ORIGIN`) and the `-p` flag in `apps/web/package.json`.

`pnpm db:setup` re-seeds from scratch every time (truncate + insert), so it is safe to rerun.

**Colima users:** keep the project inside your home folder. Colima only shares the home folder with Docker; elsewhere the init script can't be mounted and Postgres exits with `10-init-roles.sh: Is a directory`.

## Demo accounts

Every account uses the password in `SEED_PASSWORD` from `.env` (`change-me-demo-password` with the example file).

| Organization | Managers | Members |
|---|---|---|
| Acme Security | `dana@acme.test` (Dana Reyes), `omar@acme.test` (Omar Haddad) | `sam@acme.test` (Sam Patel), `lee@acme.test` (Lee Wong) |
| Globex Defense | `nina@globex.test` (Nina Diaz), `raj@globex.test` (Raj Mehta) | `alex@globex.test` (Alex Kim), `maya@globex.test` (Maya Chen) |

Each org has items in every status, including overdue ones. A quick tour: sign in as **sam** and start or submit an item, then as **dana** approve it or request changes. Try opening a Globex item's URL as an Acme user: you get "not available".

## Tests

```bash
pnpm test                         # all: API (real Postgres) then web
pnpm --filter @rw/api test        # API only: 65 tests on the remediation_test database
pnpm --filter @rw/web test        # web only: 22 tests (jsdom + Testing Library)
pnpm typecheck
```

- API tests run against a **real Postgres test database** as the same restricted role the app uses, so RLS and grants are exercised. Each test file truncates and builds its own fixture; files run one at a time.
- Nothing mocks the database. The web tests mock `fetch` only.
- The nine required tests and where each one lives: [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md).

## Session lifecycle

| Event | What happens |
|---|---|
| Sign in | A `sessions` row is created (8-hour cap). A 15-minute HS256 JWT `{sub, sid, iss, aud, iat, exp}` is set as cookie `rw_session`: `HttpOnly`, `SameSite=Strict`, `Secure` outside local HTTP, `Path=/`. |
| Each request | Signature, algorithm (HS256 only), issuer, audience and expiry are checked, then the session row and the user are loaded. A revoked or expired session, or a disabled user, gets `401 session_expired`. |
| Active use | After 10 minutes the response carries a fresh 15-minute token (never past the 8-hour cap). No refresh token exists. |
| Idle 15 minutes | The token expires, the next request gets `401`, and the UI shows "Your session expired". Unsaved form input is kept in this tab and restored after the same user signs in again. |
| Sign out | The session row is revoked and the cookie cleared. Any copy of the old token stops working immediately, even before its `exp`. |
| User disabled | The next request fails, the same as a revoked session. |

**Why a cookie and not localStorage.** An `HttpOnly` cookie can't be read by page scripts, so an XSS bug can't steal the token. It can still make requests while the page is open, which is why output is escaped by React and inputs are validated. CSRF is handled by `SameSite=Strict` and, on top of that, a required `Origin` check on every state-changing request. The browser only ever talks to its own origin through the Next.js proxy, so there is no CORS to configure.

**Login abuse.** 5 failed attempts per email and 20 per IP in 15 minutes. Wrong password, unknown email and disabled account all return the same `401` with the same timing (a dummy argon2 hash is verified for unknown emails). Throttled requests always get the same `429`, whether the account exists or not.

**Secrets.** `.env` is git-ignored; `.env.example` holds placeholders only. Logs never include bodies, cookies, tokens or passwords (see Architecture §6).

## Scope

**Done, as the brief asks:**
- Two seeded orgs with two managers and two members each; argon2id password hashes.
- Login, logout, server-side session revocation, disabled users, throttling, generic errors.
- Inbox with server-side pagination (max 50 per page), status filter and overdue filter, all in the URL.
- Manager form to create and edit (title, description, assignee, due date); reassignment keeps the status.
- Item detail with the actions the current user may take, and activity history.
- The four workflow transitions with server-side rules; edits only while Open or In progress; Closed is read-only.
- Audit rows for create, edit, reassign and every transition, written in the same transaction.
- Optimistic concurrency on every mutation, with `409` on stale writes.
- States: loading (skeleton rows), empty (per role and per filter), validation (per field), failure (banner + Try again + request id), session expired (dialog).
- Input kept after recoverable failures; double-submit protection; labeled controls; keyboard (Tab/Enter/Esc); phone and tablet layouts.

**Beyond the minimum, each for a reason in the brief:**
- Postgres row-level security as a second authorization layer under the app's own checks.
- A required proxy secret so the API only accepts traffic through the web app.
- Draft restore across re-login, limited to the same user, with a same-origin check on the `next` redirect.

## Assumptions

- **Due dates are calendar dates** (`YYYY-MM-DD`, stored as `DATE`). Overdue means `due_date < today in UTC` and not Closed. Past due dates may be set (a manager may record work that is already late).
- Any active user in the org can be an assignee, managers included. A manager can't review an item assigned to themselves; another manager must.
- Request changes keeps the completion note, so the assignee edits it rather than starting over. The reason is stored in the audit row and shown in Activity.
- Items outside your scope answer `404`, not `403`, so ids can't be probed. `403` is used when you can see the item but may not take the action.
- Disabling users has no UI (the brief asks that disabled users be denied, not that they be managed). Set `users.disabled_at` in the database.

## Known limitations

- **Per-IP login limit is shared locally.** Next.js route handlers have no trustworthy client address, so the proxy sends `127.0.0.1` for everyone and all local users share one 20-per-15-minutes counter. In production the load balancer's client-IP header must be used instead. The per-email limit is unaffected.
- **Per-email lockout can be triggered by someone else**: 5 wrong passwords lock that email for 15 minutes. Accepted tradeoff for a demo; production would add CAPTCHA or progressive delays.
- **No Content-Security-Policy yet.** Other security headers are set (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`). Fonts load from Fontshare and Google Fonts; self-hosting them would allow a strict CSP.
- **Item numbers (`RW-0013`) come from one global sequence**, so the gaps hint at how many items other orgs created. Per-org numbering would fix that.
- **OFFSET pagination and an exact count** on every list request. Fine at this size; see Architecture §5 for keyset pagination.
- **Activity shows the newest 100 events** per item, with no paging.
- **Overdue flips at 00:00 UTC**, which is 03:00 for a UTC+3 user.
- **Sign-in and sign-out are not audited**; only item events are.
- **Changing `JWT_SECRET` signs everyone out** (no key ids or rotation window).
- **Frontend tests are component tests** with mocked `fetch`. The full browser flows (sign in, act, session expiry with draft restore, phone layout) were checked by hand in Chrome, not by an automated end-to-end test.
- Not tested beyond a single machine; no load test was run.

## Out of scope, and how I would add it

- **Registration:** invite-only. A manager creates an invite (single-use, hashed token, 72-hour expiry, bound to org and role); the invitee sets a password on a page that consumes the token.
- **Password reset:** same token mechanism sent by email; on success revoke every session of that user. The request endpoint always answers the same, whether the email exists or not.
- **MFA:** TOTP (via an established library) as a second step that upgrades a "password verified" session to a full one; recovery codes stored hashed.
- **SSO:** OIDC per organization (authorization code + PKCE through an established client library); match users by verified email within the org; still create our own server session so revocation works the same.

## Next three priorities with another day

1. **Automated browser tests** (Playwright) for the three journeys checked by hand: member start → submit, manager approve / request changes, and session expiry with draft restore, plus a phone-size run.
2. **Production security gaps:** a strict CSP with self-hosted fonts, the real client IP from the load balancer for the per-IP limit, and audit events for sign-in, sign-out and failed sign-in.
3. **Per-org item numbers and keyset pagination**, which removes the cross-org hint in item numbers and keeps deep pages fast for large orgs.

## Time spent

Times are local (UTC+3). The brief allows eight hours including documentation.

| Start | End | Phase | Notes |
|-------|-----|-------|-------|
| 2026-10-20 23:20 | 2026-10-21 09:52 | Planning and design | Requirements breakdown, scope and architecture reviews, design system, UI mockups, test plan. Ran with long breaks overnight; active time was not tracked minute by minute. |
| 2026-10-21 09:52 | 10:02 | Foundation | monorepo, Postgres roles, Prisma schema + RLS, shared package, seed, test harness (RLS tests green). Lost ~3 min to a local Docker disk error and a host Postgres already on port 5432 (moved to 55432). |
| 2026-10-21 10:02 | 10:11 | Auth | login/logout, JWT verify (alg, iss, aud, exp), server sessions with revocation, disabled users, throttling, Origin + proxy-secret guards, error filter, redacted logs. 35 API tests green. |
| 2026-10-21 10:11 | 10:14 | Items | list (status/overdue filters, bounded pages, stable sort, scoped count), detail, activity, create, edit, reassign; one scope function + RLS; guarded single UPDATE with version; org-scoped active assignee (422); audit rows in the same transaction. 52 API tests green. |
| 2026-10-21 10:14 | 10:20 | Workflow | four transitions as one guarded UPDATE each (org, version, status, assignee rule); 404/403/409 explained after a miss; completion note kept on request-changes, reason in the audit row; tests 7 and 8 incl. concurrent approvals; guard-removal check. 65 API tests green. |
| 2026-10-21 10:20 | 10:35 | UI | Next.js proxy route, login, inbox split view with filters/pagination/all states, detail with actions and activity, item form with 409 banner and draft restore, session-expired dialog, responsive layouts. Web dev port moved to 3100 (3000 was taken locally). 87 tests green (65 API + 22 web). |
| 2026-10-21 10:36 | 10:44 | Review | Walked through the app as manager and member; added a show/hide password toggle; fixed a hydration warning caused by a browser extension. |
| 2026-10-21 10:44 | (this commit) | Documentation | This README, the architecture note and the handoff. |

Still planned after this commit: an automated security scan (Strix) with fixes, and a UI polish pass.

## How AI was used

I built this with **Claude Code** (Anthropic's coding agent) as the main tool, using it for planning reviews, implementation, tests and browser checks. Before writing code, I used review skills for structured passes over the plan: scope, architecture, design and test coverage. **Kling** (image generation) produced the UI mockups that `DESIGN.md` was written from. Agent configuration and planning transcripts are not in this repository; the decisions they produced are recorded here, in `DESIGN.md` and in `docs/ARCHITECTURE.md`.

I am responsible for everything here. How I checked the generated work:

- **Every security rule has a failing-first proof.** After the suite was green, I removed each guard on its own and confirmed tests failed (table below). One result surprised me: removing `org_id` from the app's scope broke **no** tests, because RLS still hid other orgs' rows. I then disabled RLS on the test database to prove each layer independently: RLS off with the scope intact passes all API tests; both off fails 8 tests.
- **RLS checked directly in `psql` as the runtime role**: no rows without `app.org_id`, only the current org's rows with it, the setting gone after commit, `DELETE` on audit rows denied.
- **Concurrency checked against real Postgres**, not mocks: two simultaneous approvals run 5 times per test run, and each time I assert one 200, one 409 and exactly one audit row.
- **The proxy checked end to end with `curl`**: cookie flags, `403` for missing or foreign `Origin`, `403` for direct calls to the API, the request id relayed, and the old cookie refused after logout.
- **The UI checked by hand in Chrome and at phone width.** I signed in as each role, requested changes, and revoked the session in the database mid-form to watch the dialog and the draft restore. This found three bugs the tests missed: a layout gap on phones, a scrollbar flicker, and seed history that listed events out of order.

**Suggestions I corrected or rejected:**
- The first plan guarded review actions only on status and assignee. A manager looking at an old screen could then approve work that had been sent back and resubmitted since. I required the client's `version` on **every** mutation, and `concurrency.spec.ts` asserts the stale-view case.
- The first plan used Next.js rewrites for the proxy. Rewrites don't guarantee how `Origin`, `X-Forwarded-For` and `Set-Cookie` are passed on, so I replaced them with an explicit route handler and a test per header.
- The straightforward way to write the transitions, checking permissions in code *before* the UPDATE, was rejected. With that check in place, deleting a WHERE condition would change nothing and the guard-removal check would prove nothing. The UPDATE's own WHERE makes the decision, and the code only explains a miss afterwards.
- The generated mockups set sentences in a monospace font and marked the selected row with a colored left border. I kept monospace for ids, dates and counts only, and used a background tint for selection.
- A reviewer suggested dropping the per-IP login limit because it is shared locally. I kept it and documented the limitation, since it is the only limit that slows one client trying many emails.

### Do the tests catch regressions?

Each guard was removed on its own, the suite was run, and the guard was restored (the suite is green again afterwards).

| Guard removed | Result |
|---|---|
| `assigneeId = actor` on start/submit | 1 failure: `items.same-org` "only the assignee can start or submit" |
| `version` in the guarded UPDATEs (edit + transitions) | 3 failures in `concurrency`: stale edit, stale edit after a transition, stale-view approve after resubmit |
| `orgId` in the items scope | **0 failures**: row-level security still returned only the actor's org, so every cross-org test stayed green |
| Row-level security disabled, scope intact | 4 failures, all in `rls.spec`; every API test stayed green |
| Row-level security disabled **and** `orgId` removed | 8 failures: the 4 above plus list/count, detail/history, edit/reassign and transitions in `items.cross-org` |

The third row is the expected result of two independent layers: either one alone keeps organizations apart, and the suite fails only when both are gone. The concurrent-approval test still passes without `version` because the `status = PENDING_REVIEW` condition also stops the second approval; the stale-view test is the one that needs `version`.
