-- Row-level security: a second layer behind the API's scope(actor) filter.
--
-- The API runs every items/audit_events query inside a transaction that first calls
--   SELECT set_config('app.org_id', '<org uuid>', true);   -- true = transaction-local
-- The setting ends with the transaction, so it never leaks to the next request on a
-- pooled connection.
--
-- Fail closed: if app.org_id is missing or empty, nullif() turns it into NULL,
-- "org_id = NULL" is never true, no row is visible and no row can be written.
--
-- FORCE makes the table owner (app_owner) obey the policies too, so the seed and the
-- test fixtures must set app.org_id like the API does.

ALTER TABLE items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE items        FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE  ROW LEVEL SECURITY;

-- items: read, create and update inside the current org. No DELETE policy: deletion is out of scope.
CREATE POLICY items_select ON items FOR SELECT
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY items_insert ON items FOR INSERT
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY items_update ON items FOR UPDATE
  USING      (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- audit_events: append-only. Read and insert inside the current org; no UPDATE or DELETE policy.
CREATE POLICY audit_select ON audit_events FOR SELECT
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY audit_insert ON audit_events FOR INSERT
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Grants for the runtime role (defaults from init-roles.sh give SELECT, INSERT, UPDATE).
REVOKE UPDATE, DELETE ON audit_events FROM app_user;      -- append-only at the grant level too
REVOKE DELETE ON items FROM app_user;                      -- explicit: never granted, never allowed
GRANT  DELETE ON login_attempts TO app_user;               -- only to prune attempts older than the window
REVOKE ALL ON _prisma_migrations FROM app_user;            -- the runtime role cannot touch migration history
