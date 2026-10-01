-- Office roles only INSERT their own queued intake -- the route handler
-- builds its response from the data it's about to insert, never reads the
-- row back, so no SELECT grant (and no RETURNING-privilege problem, per
-- the audit_log lesson from Phase 3). Admin gets full access for the
-- Phase 5 review queue.
GRANT INSERT ON "duplicate_review_queue_item" TO cswd_staff, agri_staff, civil_registry_staff;
GRANT SELECT, INSERT, UPDATE ON "duplicate_review_queue_item" TO admin;
