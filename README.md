# Secure Remediation Workspace

Organizations assign security remediation work to their people, track progress, and approve completion. Managers create, assign and review items; members start work and submit it. Every rule is enforced on the server and backed by row-level security in Postgres.

**Stack:** TypeScript · Next.js 15 (web) · NestJS 11 on Express (API) · Prisma 6 · PostgreSQL 16 · Vitest.

**[Watch the 2-minute walkthrough video](https://drive.google.com/file/d/1d1H-0rQhBsLObpaWV6eNfr7Vr2hPQsAT/view?usp=sharing)**: what the app does and why it is safe, in plain language.

- [Architecture note](docs/ARCHITECTURE.md): structure, auth, authorization, concurrency, indexes, scaling, operations.
- [Handoff for the next engineer](docs/HANDOFF.md)
- [Test matrix](docs/TEST_MATRIX.md): each of the brief's nine required tests mapped to its file.
- [Review log](docs/REVIEW_LOG.md): what each review after the build found and how it was fixed.
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
pnpm --filter @rw/api test        # API only: 74 tests on the remediation_test database
pnpm --filter @rw/web test        # web only: 31 tests (jsdom + Testing Library)
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

**Beyond the minimum** (security depth, not features): Postgres row-level security as a second authorization layer, a proxy secret so the API only accepts traffic through the web app, and draft restore across re-login for the same user.

## Assumptions

- **Due dates are calendar dates** (`YYYY-MM-DD`, stored as `DATE`). Overdue means `due_date < today in UTC` and not Closed. Past due dates may be set (a manager may record work that is already late).
- Any active user in the org can be an assignee, managers included. A manager can't review an item assigned to themselves; another manager must.
- Request changes keeps the completion note, so the assignee edits it rather than starting over. The reason is stored in the audit row and shown in Activity.
- Items outside your scope answer `404`, not `403`, so ids can't be probed. `403` is used when you can see the item but may not take the action.
- Disabling users has no UI (the brief asks that disabled users be denied, not that they be managed). Set `users.disabled_at` in the database.

## Known limitations

- **Per-IP login limit is shared locally.** Next.js route handlers have no trustworthy client address, so the proxy sends `127.0.0.1` for everyone and all local users share one 20-per-15-minutes counter: 20 failed sign-ins from anyone lock every local user out for 15 minutes. In production the load balancer's client-IP header must be used instead. The per-email limit is unaffected.
- **Per-email lockout can be triggered by someone else**: 5 wrong passwords lock that email for 15 minutes. Accepted tradeoff for a demo; production would add CAPTCHA or progressive delays.
- **The Content-Security-Policy allows inline scripts.** It blocks external script hosts, cross-origin requests, framing, plugins, `<base>` and cross-origin form posts, but Next.js injects inline bootstrap scripts, so `script-src` has `'unsafe-inline'` until a per-request nonce is added. Fonts load from Fontshare and Google Fonts (allowed by name). HSTS is sent in production builds only.
- **Item numbers (`RW-0013`) come from one global sequence**, so the gaps hint at how many items other orgs created. Per-org numbering would fix that.
- **OFFSET pagination and an exact count** on every list request. Fine at this size; see Architecture §5 for keyset pagination.
- **Activity shows the newest 100 events** per item, with no paging.
- **Overdue flips at 00:00 UTC**, which is 03:00 for a UTC+3 user.
- **Sign-in and sign-out are not audited**; only item events are.
- **Expired `sessions` rows are never deleted.** They are harmless (checked by expiry) but grow with every sign-in; a nightly cleanup job would fix it.
- **Leaving the edit form through an in-app link doesn't warn** about unsaved changes; only closing or reloading the tab does.
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
2. **Production security gaps:** a nonce-based CSP (no `'unsafe-inline'`), the real client IP from the load balancer for the per-IP limit, and audit events for sign-in, sign-out and failed sign-in.
3. **Per-org item numbers and keyset pagination**, which removes the cross-org hint in item numbers and keeps deep pages fast for large orgs.

## Time spent

Local time (UTC+3), from the commit history. The brief allows eight hours including documentation.

| When | Phase | What | Minutes |
|---|---|---|---|
| 10-20 23:20 to 10-21 09:52 | Planning and design | Requirements breakdown, scope and architecture reviews, design system, mockups, test plan. Spread over the evening with long breaks; this row is my estimate of active time, the only one not backed by commits. | ~180 |
| 09:52 to 10:35 | Build | Foundation, auth, items, workflow, UI (commits 10:01 to 10:35). 87 tests green. | 43 |
| 10:35 to 11:19 | First review and docs | Walk-through as each role, README, architecture note, handoff, accessibility pass, independent security review and its fixes. | 44 |
| 12:28 to 12:32 | Housekeeping | Ignore local browser snapshots. | 4 |
| 14:05 to 14:20 | Phone pass | 44px touch targets, 16px inputs. | 15 |
| 14:24 to 14:45 | Strix scan 1 | Stopped by the model provider after 12 minutes. | 21 |
| 14:48 to 15:12 | Final code review | 9 fixes, each with a failing-first test. 96 tests green. | 24 |
| 15:46 to 16:55 | Strix scan 2 and fixes | Full scan (37 minutes of it waiting), open-redirect fix, Vitest upgrade, docs. 100 tests green. | 69 |
| 17:05 to 17:40 | Grader-style review | Fresh-clone run, requirement check, the fixes in the review log section 4. 105 tests green. | 35 |

**Total: about 7 h 15 min**, within the limit. The build rows are short because the coding agent wrote most of the code in minutes; most of my time went into planning, reviewing and checking what it produced. The walkthrough video is optional, was made separately, and is not counted.

## Security review

Run after the build, against the source and the running app. Details and every fix: [docs/REVIEW_LOG.md](docs/REVIEW_LOG.md).

| Check | Tool | Result |
|---|---|---|
| Independent security review | A separate security-auditor agent with no build context: source audit plus live attacks | 1 Low fixed (`413` mapping); CSP and HSTS added |
| Third-party pentest | [Strix](https://github.com/usestrix/strix) 1.6, standard mode, 40 areas, active exploitation included | 1 Medium fixed (encoded open redirect in `next`); 4 dev-dependency advisories fixed by upgrading Vitest |
| Static analysis and secrets | Semgrep, Gitleaks, TruffleHog (run by Strix); a manual scan of the git history | 0 issues, 0 secrets |
| Dependencies | `pnpm audit --prod`, Trivy | 5 transitive production advisories pinned to patched versions; clean now |
| Code reviews | A pre-landing checklist review, a correctness-only review, and a grader-style review with a fresh clone | 11 bug fixes, each with a test that failed first; 4 missing tests added; 3 indexes, checked with `EXPLAIN` |
| Regression proof | Removing each guard and running the suite | Every guard is caught by a test (table at the end) |

## How AI was used

I built this with **Claude Code** (Anthropic's coding agent) as the main tool, using it for planning reviews, implementation, tests and browser checks. Before writing code, I used review skills for structured passes over the plan: scope, architecture, design and test coverage. **Kling** (image generation) produced the UI mockups that `DESIGN.md` was written from. Agent configuration and planning transcripts are not in this repository; the decisions they produced are recorded here, in `DESIGN.md` and in `docs/ARCHITECTURE.md`.

- **Review skills used inside Claude Code:** gstack (office-hours, plan-ceo-review, plan-eng-review, plan-design-review, design-consultation) for the plan, and impeccable, web-design-guidelines and emil-design-eng for the UI audits.
- **Security:** a separate security-auditor agent for the independent review, Strix for the third-party scan, and separate review passes at the end (see Security review).
- **Walkthrough video** (linked at the top): made with Remotion, a local open-source voice (Kokoro) and real screenshots.

I am responsible for everything here. How I checked the generated work:

- **Every guard has a test that fails without it.** I removed each one and ran the suite (table below). Removing `org_id` from the app's scope broke **no** tests, because RLS still hid other orgs' rows, so I also disabled RLS to prove each layer on its own.
- **RLS checked in `psql` as the runtime role:** no rows without `app.org_id`, only the current org's rows with it, `DELETE` on audit rows denied.
- **Concurrency against real Postgres:** two simultaneous approvals, 5 times per run, asserting one `200`, one `409` and one audit row.
- **The proxy with `curl`:** cookie flags, `403` for a missing or foreign `Origin` and for direct API calls, the old cookie refused after logout.
- **The UI by hand in Chrome and at phone width,** as each role, including revoking the session mid-form. This found three bugs the tests missed: a phone layout gap, a scrollbar flicker, and seed history out of order.

**Suggestions I corrected or rejected:**
- The first plan guarded review actions only on status and assignee, so a manager on an old screen could approve work that had been sent back and resubmitted. I required the client's `version` on every mutation; `concurrency.spec.ts` covers the stale view.
- The straightforward transitions checked permissions in code *before* the UPDATE. Then deleting a WHERE condition changes nothing and the guard-removal check proves nothing. The UPDATE's WHERE makes the decision; the code only explains a miss afterwards.
- The first plan used Next.js rewrites for the proxy, which don't guarantee how `Origin`, `X-Forwarded-For` and `Set-Cookie` pass through. I replaced them with an explicit route handler and a test per header.
- The generated login throttle had a race: parallel attempts slipped past the limit, and the one-at-a-time tests could not see it. I reproduced it with a parallel test, then fixed it.
- One review finding was wrong (that `.gitignore` names agent tooling); I checked and rejected it. A suggestion to drop the per-IP limit was also rejected: it is the only limit that slows one client trying many emails.

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
