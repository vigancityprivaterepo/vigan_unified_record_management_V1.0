-- Office records pages list an office's own intakes still waiting in the
-- duplicate review queue ("Awaiting review"). office_staff could only
-- INSERT here until now. Column-level on purpose: fuzzy_matches holds other
-- citizens' names/birthdates from resolvePerson(), and reviewer columns are
-- admin business -- neither is readable by office staff. Same app-layer
-- isolation as office_record (routes/office.ts filters on module_id after
-- requireOfficeAccess), so this grant is table-wide like every other
-- office_staff grant (see 20260827120100_grant_office_staff).
GRANT SELECT ("id", "module_id", "candidate_data", "status", "created_at") ON "duplicate_review_queue_item" TO office_staff;
