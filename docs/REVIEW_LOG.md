# Review log

What each review after the build found, and what was done about it. The README has the summary; this is the detail.

## 1. Independent security review

A separate agent with no context from the build session audited the code and attacked the running app. It tried cross-org and same-org IDOR, mass assignment and `__proto__` keys, JWT tampering (`alg: none`, stripped and altered signatures), CSRF (missing, `null` and foreign `Origin`), direct calls that skip the proxy, proxy path traversal, open redirects through `next`, self-review, access after reassignment and after logout, account enumeration, throttling, oversized pages, XSS sinks and RLS gaps. All were blocked, except one encoded redirect variant that Strix found later (section 2).

- **Fixed:** an oversized request body returned `500` instead of `413` (now mapped, with a test). A Content-Security-Policy and production HSTS were added.
- **Accepted and documented:** the shared per-IP login counter behind the local proxy (README, Known limitations).
- **Dependencies:** `pnpm audit --prod` reported 5 advisories in transitive packages: `postcss` inside Next.js (build time, our own CSS) and `deepmerge-ts` inside the Prisma CLI. Neither receives user input. Both are pinned to patched versions with `pnpm` overrides; the audit is clean.
- **Secrets:** the full git history was scanned. No `.env` value or credential appears in any commit.

## 2. Strix (third-party AI pentest tool)

Standard scan of the source and of the running app as anonymous, manager and member. The first run was stopped after 12 minutes by the model provider's content guardrails. A second run with another model completed every phase, active exploitation included, in 37 minutes. It covered 40 areas and reported 5 findings.

- **Open redirect (Medium), fixed.** `next=/%2e%2e//evil.test` passed the checks: the URL parser resolves it to the path `//evil.test`, which a browser treats as another host, so after sign-in the user would leave the app. `safeNext` now rejects any *parsed* path that starts with `//`. Four encoded variants were added to `safe-next.spec.ts`; they failed before the fix.
- **Four advisories in Vitest 3.2.7 and its `tinypool` and `@vitest/mocker` packages (2 High, 2 Medium).** Test-only; exploiting them needs an exposed Vitest dev server. Upgraded to Vitest 4.1.11, which removes all three packages from the lockfile.
- **Ruled out with live requests:** cross-org and same-org IDOR, mass assignment, SQL injection on every input, stored XSS, JWT tampering, session replay after logout, CSRF on every write, proxy path traversal and header injection, workflow and assignment races, error-based information disclosure.
- Semgrep, Gitleaks and TruffleHog: 0 issues, 0 secrets.

## 3. Final code review

Two independent reviews of the whole codebase: one against a pre-landing checklist (correctness, security, test gaps, doc drift), one correctness-only. 16 findings, 15 real. Each bug fix started with a test that failed on the old code.

| Finding | Fix | Test |
|---|---|---|
| **Login throttle race:** 30 parallel wrong passwords for one email were all checked; none got `429` | Each attempt writes its row before counting, so the n-th attempt sees n rows and at most 5 pass, with no lock | `security.spec.ts`: 20 parallel attempts, at most 5 reach the password check |
| A `version` above the int4 range returned `500` | One shared `version` schema capped at 2,147,483,647, so it is a `400` | `items.crud.spec.ts` |
| A request with an unsupported charset returned `500` | Body-parser client errors keep their own 4xx status | `security.spec.ts` (`415`) |
| An edit that changed nothing bumped the version, so other editors got a false `409` | Nothing is written when nothing changes | `items.crud.spec.ts` |
| A short database outage cleared every session cookie | The cookie is cleared only when the session is rejected (`401`) | `auth.logout.spec.ts`, added in section 4 |
| The completion note or reason was lost when the session expired on the detail page | Saved as a same-user draft and restored after sign-in | `item-detail.spec.tsx` |
| The proxy buffered request bodies of any size | Refuses anything over 64 KB before reading it (`413`) | `proxy.spec.ts` |
| A page number past the end showed "No remediation items yet" and a broken range | "No items on this page" with a link to page 1; the page must be an integer | `inbox.spec.tsx` |
| Blocked browser storage turned a successful save or sign-in into an error | Draft storage calls never throw | `drafts.spec.ts` |

Also fixed: two dead branches, an unused module export, a public method documented as internal, an unescaped id in a CSS selector, and doc drift.

**Rejected after checking:** one finding said the tracked `.gitignore` names agent tooling. It does not.

## 4. Grader-style review

A last pass as a hiring reviewer would do it: a fresh clone following the README with the example `.env` (setup, seed, 100 tests and typecheck all passed), then every requirement in the brief checked against the code.

| Finding | Fix | Proof |
|---|---|---|
| The cookie fix in section 3 had no test, though the table claimed one for every fix | Test: a database outage gives `503` and keeps the cookie; a revoked session gives `401` and clears it | Fails when the guard clears the cookie on every error |
| No test that reassignment keeps the status, or that review and closed items can't be reassigned | Three tests, each checking the stored row and that no audit row was written on `409` | Fail when the status condition is removed from the UPDATE, or when reassignment resets the status |
| The default inbox (no status filter) sorted in memory: both item indexes lead with `status`. The throttle's prune scanned a whole index on every sign-in | Indexes `(org_id, due_date, id)`, `(org_id, assignee_id, due_date, id)` and `login_attempts (created_at)` | `EXPLAIN` before and after: the sort step and the full index scan are gone |
| After a conflict, "Reload latest" replaced the manager's typed changes without asking, under a banner saying they were kept | A confirmation dialog when the form has unsaved changes; "Keep my changes" is the focused default | `item-form.spec.tsx`, which failed before the change |
| The time table did not cover every commit and its total did not add up | Rebuilt from commit times | README, Time spent |
| The README was too long | Review detail moved to this file | |

## 5. Hardening pass

After the grader-style review, the remaining items from the README's priorities that fit in the time:

| Change | Proof |
|---|---|
| Browser tests with Playwright on the real stack: sign-in and sign-out (desktop and phone), start → submit → approve with history, other members' and other orgs' items refused in the UI and the API | `e2e/journeys.spec.ts`, 3 consecutive green runs, then green against a production build |
| Nonce-based CSP: scripts need this response's nonce; `'unsafe-inline'` is gone from `script-src` | `e2e/csp.spec.ts` failed before the change; passes in dev and in a production build with no CSP violations |
| The per-IP limit can use the load balancer's client IP (`TRUSTED_CLIENT_IP_HEADER`), taking its last hop and ignoring anything that isn't an IP | `proxy.spec.ts`, failed before the change |
| In-app links (Cancel, breadcrumb, sidebar) ask before leaving a form with unsaved changes | `item-form.spec.tsx`, failed before the change |
| Inbox query times measured at 200,000 items | `apps/api/scripts/perf-*.sql`; results in Architecture §4 |
| Fresh clone from GitHub, README only: setup, 107 tests, typecheck and the 6 browser tests green. It also showed the dev server the browser tests start was left running on port 3100; Playwright now stops it with `SIGTERM` | Ports 3100 and 4000 free after the run |

**Kept, and why:** a reassigned member sees the item's full history, including the previous assignee's completion note, because they continue the same work. The per-IP login counter stays (README, Known limitations).
