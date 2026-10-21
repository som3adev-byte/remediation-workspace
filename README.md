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
pnpm --filter @rw/api test        # API only: 70 tests on the remediation_test database
pnpm --filter @rw/web test        # web only: 30 tests (jsdom + Testing Library)
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

- **Per-IP login limit is shared locally.** Next.js route handlers have no trustworthy client address, so the proxy sends `127.0.0.1` for everyone and all local users share one 20-per-15-minutes counter: 20 failed sign-ins from anyone lock every local user out for 15 minutes. In production the load balancer's client-IP header must be used instead. The per-email limit is unaffected.
- **Per-email lockout can be triggered by someone else**: 5 wrong passwords lock that email for 15 minutes. Accepted tradeoff for a demo; production would add CAPTCHA or progressive delays.
- **The Content-Security-Policy allows inline scripts.** It blocks external script hosts, cross-origin requests, framing, plugins, `<base>` and cross-origin form posts, but Next.js injects inline bootstrap scripts, so `script-src` has `'unsafe-inline'` until a per-request nonce is added. Fonts load from Fontshare and Google Fonts (allowed by name). HSTS is sent in production builds only.
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
2. **Production security gaps:** a nonce-based CSP (no `'unsafe-inline'`), the real client IP from the load balancer for the per-IP limit, and audit events for sign-in, sign-out and failed sign-in.
3. **Per-org item numbers and keyset pagination**, which removes the cross-org hint in item numbers and keeps deep pages fast for large orgs.

## Time spent

Times are local (UTC+3). The brief allows eight hours including documentation.

| Start | End | Phase | Notes |
|-------|-----|-------|-------|
| 2026-10-20 23:20 | 2026-10-21 09:52 | Planning and design (about 3 h active) | Requirements breakdown, scope and architecture reviews, design system, UI mockups, test plan. Spread over the evening with long breaks; about 3 hours of actual work. |
| 2026-10-21 09:52 | 10:02 | Foundation | monorepo, Postgres roles, Prisma schema + RLS, shared package, seed, test harness (RLS tests green). Lost ~3 min to a local Docker disk error and a host Postgres already on port 5432 (moved to 55432). |
| 2026-10-21 10:02 | 10:11 | Auth | login/logout, JWT verify (alg, iss, aud, exp), server sessions with revocation, disabled users, throttling, Origin + proxy-secret guards, error filter, redacted logs. 35 API tests green. |
| 2026-10-21 10:11 | 10:14 | Items | list (status/overdue filters, bounded pages, stable sort, scoped count), detail, activity, create, edit, reassign; one scope function + RLS; guarded single UPDATE with version; org-scoped active assignee (422); audit rows in the same transaction. 52 API tests green. |
| 2026-10-21 10:14 | 10:20 | Workflow | four transitions as one guarded UPDATE each (org, version, status, assignee rule); 404/403/409 explained after a miss; completion note kept on request-changes, reason in the audit row; tests 7 and 8 incl. concurrent approvals; guard-removal check. 65 API tests green. |
| 2026-10-21 10:20 | 10:35 | UI | Next.js proxy route, login, inbox split view with filters/pagination/all states, detail with actions and activity, item form with 409 banner and draft restore, session-expired dialog, responsive layouts. Web dev port moved to 3100 (3000 was taken locally). 87 tests green (65 API + 22 web). |
| 2026-10-21 10:36 | 10:44 | Review | Walked through the app as manager and member; added a show/hide password toggle; fixed a hydration warning caused by a browser extension. |
| 2026-10-21 10:44 | 10:47 | Documentation | This README, the architecture note and the handoff. |
| 2026-10-21 10:47 | 11:19 | UI review + security review | Accessibility, motion and contrast passes (WCAG AA tokens), Phosphor icons; independent security review (see below), dependency audit, fixes. |
| 2026-10-21 14:24 | 14:45 | Strix scan | Third-party scan of the source and the running app; see Security review. |
| 2026-10-21 14:48 | 15:03 | Final review | Two independent code reviews (a checklist-driven reviewer and a correctness review). Fixed: a race that let parallel sign-in attempts bypass the per-email limit, an out-of-range version returning 500, other body-parser errors returning 500, no-op edits bumping the version, a database hiccup clearing session cookies, unsaved completion notes on session expiry, an unbounded body in the proxy, the past-the-end inbox page, storage errors in drafts. Each fix has a test that failed first. 96 tests green (70 API + 26 web). |
| 2026-10-21 15:46 | 16:30 | Strix full scan + fixes | Second Strix run with another model, which completed the active phase (37 min). Fixed its one code finding (encoded open redirect) with a failing-first test and upgraded Vitest to clear four dev-dependency advisories. 100 tests green (70 API + 30 web). |

**Total: about 5 h 55 min**: planning about 3 h, build and documentation 09:52 to 11:19, the two Strix scans and their fixes about 65 min, and the final review about 20 min. Within the 8-hour limit.


## Security review

Run after the build, against the running app and the source.

| Check | Tool | What it covered | Result |
|---|---|---|---|
| Independent security review | A separate security-auditor agent with no build context | Source audit plus live attacks on the running app (list below) | 1 Low fixed (`413` mapping), CSP + HSTS added |
| Third-party pentest | [Strix](https://github.com/usestrix/strix) 1.6, standard mode, source + live app as anonymous, manager and member | 40 areas, active exploitation included | 1 Medium in code (open redirect) fixed; 4 dev-dependency advisories fixed |
| Static analysis | Semgrep (run by Strix) | 84 source files | 0 issues |
| Secrets | Gitleaks, TruffleHog (run by Strix), plus a manual scan of the git history | Every commit | 0 secrets |
| Dependencies | `pnpm audit --prod`, Trivy (run by Strix) | Production and dev dependencies in `pnpm-lock.yaml` | Production: 5 transitive advisories pinned to patched versions. Dev: Vitest upgraded. Both clean now |
| Code review | Two independent reviews: a pre-landing checklist and a correctness-only pass | Whole codebase | 15 real findings fixed, each with a failing-first test (see Final code review) |
| Regression proof | Removing each guard and running the suite | Every authorization and concurrency guard | Every guard is caught by a test (see "Do the tests catch regressions?") |

- **Independent review.** A separate agent with no context from the build session audited the code and attacked the running app. It tried cross-org and same-org IDOR, mass assignment and `__proto__` keys, JWT tampering (`alg: none`, stripped and altered signatures), CSRF (missing, `null` and foreign `Origin`), direct calls that skip the proxy, proxy path traversal, open redirects through `next` (one encoded variant was missed; Strix found it later, below), self-review, access after reassignment and after logout, account enumeration, throttling, oversized pages, XSS sinks and RLS gaps. All of these were blocked. It found no Critical, High or Medium issues.
- **Fixed from that review:** an oversized request body returned `500` instead of `413` (now mapped, with a test), and a Content-Security-Policy plus production HSTS were added.
- **Accepted and documented:** the shared per-IP login counter behind the local proxy (Known limitations).
- **Dependencies:** `pnpm audit --prod` reported 5 advisories in transitive packages: `postcss` inside Next.js, used at build time on our own CSS, and `deepmerge-ts` inside the Prisma CLI. Neither receives user input. Both are pinned to patched versions with `pnpm` overrides, and the audit is now clean.
- **Secrets:** the full git history was scanned. No `.env` value and no credential appears in any commit.
- **Strix (third-party AI pentest tool), standard scan of the source and the running app.** The first run was stopped after 12 minutes by the model provider's content guardrails. A second run with a different model completed every phase, including active exploitation, in 37 minutes. It tested 40 areas and reported 5 findings:
  - **Open redirect (Medium), real and fixed.** `next=/%2e%2e//evil.test` passed the checks, because the URL parser turns it into the path `//evil.test`, which a browser treats as another site. After sign-in the user would leave the app. `safeNext` now rejects any parsed path that starts with `//`. Four encoded variants were added to `safe-next.spec.ts`; they failed before the fix.
  - **Four advisories in Vitest 3.2.7 and its `tinypool` and `@vitest/mocker` packages (2 High, 2 Medium).** Test-only: no production path loads them, and exploiting them needs an exposed Vitest dev server. Upgraded to Vitest 4.1.11, which removes all three packages from the lockfile. All 100 tests pass on the new version.
  - **Ruled out with live requests:** cross-org and same-org IDOR, mass assignment, SQL injection on every input, stored XSS, JWT tampering, session replay after logout, CSRF on every write, proxy path traversal and header injection, workflow and assignment races, error-based information disclosure.
  - Static analysis (Semgrep, Gitleaks, TruffleHog): 0 issues, 0 secrets.

## Final code review

Before submission the whole codebase was reviewed twice, independently: once against a pre-landing review checklist (correctness, security, test gaps, doc drift), once as a correctness-only review. Together they raised 16 findings; 15 were real.

Every bug fix started with a test that failed on the old code, so each one is proven, not assumed:

| Finding | Fix | Test |
|---|---|---|
| **Login throttle race:** 30 parallel wrong passwords for one email were all checked; none got `429` | Each attempt writes its row before counting, so the n-th attempt always sees n rows and at most 5 pass, with no lock | `security.spec.ts`: 20 parallel attempts, at most 5 reach the password check |
| A `version` above the int4 range returned `500` | One shared `version` schema capped at 2,147,483,647, so it is a `400` | `items.crud.spec.ts` |
| A request with an unsupported charset returned `500` | Body-parser client errors keep their own 4xx status | `security.spec.ts` (`415`) |
| An edit that changed nothing bumped the version, so other editors got a false `409` | Nothing is written when nothing changes | `items.crud.spec.ts` |
| A short database outage cleared every session cookie | The cookie is cleared only when the session is really rejected (`401`) | code path in `auth.guard.ts` |
| The completion note or reason was lost when the session expired on the detail page | Saved as a same-user draft and restored after sign-in | `item-detail.spec.tsx` |
| The proxy buffered request bodies of any size | Refuses anything over 64 KB before reading it (`413`) | `proxy.spec.ts` |
| A page number past the end showed "No remediation items yet" and a broken range | "No items on this page" with a link to page 1; the page must be an integer | `inbox.spec.tsx` |
| Blocked browser storage turned a successful save or sign-in into an error | Draft storage calls never throw | `drafts.spec.ts` |

Also fixed: two dead branches, an unused module export, a public method documented as internal, an unescaped id in a CSS selector, and doc drift (test counts, a stale handoff list, a wrong route name).

**Not changed, already documented as limitations:** the shared per-IP login counter behind the local proxy, and item numbers from one global sequence.

**Rejected after checking:** one finding said the tracked `.gitignore` names agent tooling. It does not: those entries live only in the local `.git/info/exclude`.

## How AI was used

I built this with **Claude Code** (Anthropic's coding agent) as the main tool, using it for planning reviews, implementation, tests and browser checks. Before writing code, I used review skills for structured passes over the plan: scope, architecture, design and test coverage. **Kling** (image generation) produced the UI mockups that `DESIGN.md` was written from. Agent configuration and planning transcripts are not in this repository; the decisions they produced are recorded here, in `DESIGN.md` and in `docs/ARCHITECTURE.md`.

- **Review skills used inside Claude Code:** gstack (office-hours, plan-ceo-review, plan-eng-review, plan-design-review, design-consultation) for the plan, and impeccable, web-design-guidelines and emil-design-eng for the UI audits.
- **Security:** a separate security-auditor agent for the independent review, and Strix for the third-party scan (see Security review).
- **Presentation film:** a short presentation film of the app, outside this repository and not part of the submission, made with Remotion, a local open-source voice (Kokoro) and real screenshots.

I am responsible for everything here. How I checked the generated work:

- **Every security rule has a failing-first proof.** After the suite was green, I removed each guard on its own and confirmed tests failed (table below). One result surprised me: removing `org_id` from the app's scope broke **no** tests, because RLS still hid other orgs' rows. I then disabled RLS on the test database to prove each layer independently: RLS off with the scope intact fails only the 4 RLS tests, while every API authorization test still passes; both off fails 8 tests.
- **RLS checked directly in `psql` as the runtime role**: no rows without `app.org_id`, only the current org's rows with it, the setting gone after commit, `DELETE` on audit rows denied.
- **Concurrency checked against real Postgres**, not mocks: two simultaneous approvals run 5 times per test run, and each time I assert one 200, one 409 and exactly one audit row.
- **The proxy checked end to end with `curl`**: cookie flags, `403` for missing or foreign `Origin`, `403` for direct calls to the API, the request id relayed, and the old cookie refused after logout.
- **The UI checked by hand in Chrome and at phone width.** I signed in as each role, requested changes, and revoked the session in the database mid-form to watch the dialog and the draft restore. This found three bugs the tests missed: a layout gap on phones, a scrollbar flicker, and seed history that listed events out of order.

**Suggestions I corrected or rejected:**
- The first plan guarded review actions only on status and assignee. A manager looking at an old screen could then approve work that had been sent back and resubmitted since. I required the client's `version` on **every** mutation, and `concurrency.spec.ts` asserts the stale-view case.
- The first plan used Next.js rewrites for the proxy. Rewrites don't guarantee how `Origin`, `X-Forwarded-For` and `Set-Cookie` are passed on, so I replaced them with an explicit route handler and a test per header.
- The straightforward way to write the transitions, checking permissions in code *before* the UPDATE, was rejected. With that check in place, deleting a WHERE condition would change nothing and the guard-removal check would prove nothing. The UPDATE's own WHERE makes the decision, and the code only explains a miss afterwards.
- The generated mockups set sentences in a monospace font and marked the selected row with a colored left border. I kept monospace for ids, dates and counts only, and used a background tint for selection.
- The final review found a race in the generated login throttle (parallel attempts slipped past the limit). The original tests only sent attempts one at a time, so they could not see it. I reproduced it with a parallel test before fixing it (see Final code review).
- The independent security review tested open redirects through `next` and passed them; Strix later found an encoded variant (`/%2e%2e//host`) that both the review and the tests missed. I reproduced it, added the cases as failing tests and fixed it at the parsed path.
- One final-review finding was wrong (it said `.gitignore` lists agent tooling); I checked the tracked file and rejected it.
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
