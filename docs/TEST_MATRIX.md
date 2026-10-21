# Test matrix

Each required test from the brief (page 4, "Automated tests") mapped to the behavior it protects and the file that covers it. Authorization and persistence tests run against a real Postgres test database; nothing mocks the database.

| # | Brief requirement | What the test asserts | File |
|---|---|---|---|
| 1 | Successful login and an authenticated request | Login sets an HttpOnly session cookie; `GET /me` with it returns the user's id, org and role from the database | `apps/api/test/auth.login.spec.ts` |
| 2 | Invalid credentials and malformed, tampered, expired, wrong-issuer and wrong-audience tokens | Wrong password and unknown email return the same 401 body; each bad token returns 401; an `alg: none` token is rejected | `apps/api/test/auth.tokens.spec.ts` |
| 3 | Logout or session revocation preventing subsequent access | After logout the old cookie returns 401 `session_expired`; a revoked session row blocks a still-valid JWT | `apps/api/test/auth.logout.spec.ts` |
| 4 | A disabled user being denied access | Disabling a user makes their live session return 401; their login returns the generic error | `apps/api/test/auth.disabled.spec.ts` |
| 5 | Cross-organization access attempts against reads and mutations | List, count, detail, history, edit, reassign and every transition on another org's item return 404; assigning to another org's user returns 422; RLS returns no rows without `app.org_id` | `apps/api/test/items.cross-org.spec.ts`, `apps/api/test/rls.spec.ts` |
| 6 | An unauthorized action within the same organization | A member cannot see or act on another member's item (404), cannot create or edit (403); a manager cannot review an item assigned to them (403); a reassigned member loses access (404) | `apps/api/test/items.same-org.spec.ts` |
| 7 | A valid workflow and an invalid transition | Open → In progress → Pending review → Closed writes one audit row per step; approving an Open item returns 409; closed items are read-only | `apps/api/test/workflow.spec.ts` |
| 8 | A stale edit or competing review action, checking persisted state and audit consistency | An edit with an old version returns 409 and writes no audit row; two concurrent approvals produce one 200, one 409 and one audit row; a stale-view approval after request-changes and resubmit returns 409 | `apps/api/test/concurrency.spec.ts` |
| 9 | One frontend interaction (validation, submission failure or session expiration) | The item form shows field errors and keeps input on 400; on 409 it shows the conflict banner and keeps input; on 401 it saves the draft and restores it only for the same user | `apps/web/test/item-form.spec.tsx` |

## Extra checks beyond the nine

| Behavior | File |
|---|---|
| Missing or foreign `Origin` on a write returns 403 | `apps/api/test/security.origin.spec.ts` |
| A request that skips the web proxy (no proxy secret) returns 403 | `apps/api/test/security.proxy.spec.ts` |
| Login throttling returns the same 429 for unknown and real emails | `apps/api/test/auth.throttle.spec.ts` |
| `next` redirect only accepts same-origin paths | `apps/web/test/safe-next.spec.ts` |

## Verifying the tests catch regressions

After the suite is green, each of these guards is removed on its own, the suite is run, and the guard is restored. The results are recorded in the README.

1. `orgId` in the items scope
2. `assigneeId = actor` on start/submit
3. `version` in the guarded update
