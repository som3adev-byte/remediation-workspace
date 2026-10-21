-- Default inbox (no status filter) and the overdue filter sort by due date then id.
CREATE INDEX "items_org_id_due_date_id_idx" ON "items"("org_id", "due_date", "id");
CREATE INDEX "items_org_id_assignee_id_due_date_id_idx" ON "items"("org_id", "assignee_id", "due_date", "id");

-- The throttle deletes rows older than its window on every sign-in.
CREATE INDEX "login_attempts_created_at_idx" ON "login_attempts"("created_at");
