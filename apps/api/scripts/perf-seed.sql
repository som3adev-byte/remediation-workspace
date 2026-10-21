-- Load test data for query timing. Runs on the TEST database only, as the superuser
-- (bulk insert across orgs, bypassing RLS). The API test suite truncates it again.
--   20 orgs, 1 manager + 10 members each, 200,000 items: one large org with 50,000,
--   the other 19 with about 7,900 each. Random status and due dates within +/- 60 days.
\set ON_ERROR_STOP on
TRUNCATE audit_events, sessions, items, login_attempts, users, organizations CASCADE;

CREATE TEMP TABLE o AS
  SELECT gen_random_uuid() AS id, g AS n FROM generate_series(1, 20) g;
INSERT INTO organizations (id, name) SELECT id, 'Org ' || n FROM o;

CREATE TEMP TABLE u AS
  SELECT gen_random_uuid() AS id, o.id AS org_id, o.n, m
  FROM o, generate_series(0, 10) m;              -- m = 0 is the manager
INSERT INTO users (id, org_id, email, name, role, password_hash)
  SELECT id, org_id, 'u' || n || '-' || m || '@perf.test', 'User ' || n || '-' || m,
         (CASE WHEN m = 0 THEN 'MANAGER' ELSE 'MEMBER' END)::"Role", 'x'
  FROM u;

INSERT INTO items (id, org_id, title, description, assignee_id, due_date, status, created_by_id, updated_at)
  SELECT gen_random_uuid(), o.id, 'Item ' || g, 'Load test item',
         (SELECT id FROM u WHERE u.org_id = o.id AND u.m = 1 + (g % 10)),
         current_date + (random() * 120 - 60)::int,
         (ARRAY['OPEN','IN_PROGRESS','PENDING_REVIEW','CLOSED'])[1 + (g % 4)]::"ItemStatus",
         (SELECT id FROM u WHERE u.org_id = o.id AND u.m = 0),
         now()
  FROM o, generate_series(1, CASE WHEN o.n = 1 THEN 50000 ELSE 7895 END) g;

ANALYZE;
SELECT count(*) AS items, count(DISTINCT org_id) AS orgs FROM items;
