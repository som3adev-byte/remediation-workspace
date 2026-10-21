-- The inbox queries the API runs, timed as the runtime role (app_user) so RLS applies.
-- Pass the large org and one of its members:  -v org=<uuid> -v member=<uuid>
\set ON_ERROR_STOP on
SELECT set_config('app.org_id', :'org', false);

\echo '1. Manager inbox, default view, page 1'
EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM items WHERE org_id = :'org' ORDER BY due_date, id LIMIT 20;
\echo '2. Manager inbox, status = Open'
EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM items WHERE org_id = :'org' AND status = 'OPEN' ORDER BY due_date, id LIMIT 20;
\echo '3. Manager inbox, overdue'
EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM items WHERE org_id = :'org' AND due_date < current_date AND status <> 'CLOSED' ORDER BY due_date, id LIMIT 20;
\echo '4. Member inbox, default view'
EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM items WHERE org_id = :'org' AND assignee_id = :'member' ORDER BY due_date, id LIMIT 20;
\echo '5. Total for the manager default view'
EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*) FROM items WHERE org_id = :'org';
\echo '6. Deep page (page 2,000 of 2,500, OFFSET 39,980)'
EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM items WHERE org_id = :'org' ORDER BY due_date, id LIMIT 20 OFFSET 39980;
