-- RBAC role + grants for admin-created dynamic offices. Unlike every office
-- before it, this is ONE shared role for every dynamic office (not one role
-- per office) -- see the schema.prisma comment above the Office model for
-- why: a dedicated-role-per-office was tried once already for
-- business_permits_staff and reverted (20260827110000). Isolation between
-- dynamic offices is enforced at the application layer (WHERE office_id =
-- ...), not by Postgres grants -- office_staff's grants below are
-- table-wide, same as this migration's RLS policies (USING (true), the
-- same permissive-but-present pattern the Phase 3 migration uses).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'office_staff') THEN
    CREATE ROLE office_staff LOGIN PASSWORD 'changeme_provision_immediately';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO office_staff', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO office_staff;

GRANT SELECT ON "office", "office_form_field" TO office_staff;
GRANT SELECT, INSERT, UPDATE ON "office_record" TO office_staff;

-- admin manages offices/fields (create/edit/deactivate) and can view every
-- dynamic office's records, same as it can for the fixed offices.
GRANT SELECT, INSERT, UPDATE ON "office", "office_form_field", "office_record" TO admin;

ALTER TABLE "office_record" ENABLE ROW LEVEL SECURITY;
CREATE POLICY office_record_office_staff ON "office_record" FOR ALL TO office_staff USING (true) WITH CHECK (true);
CREATE POLICY office_record_admin ON "office_record" FOR ALL TO admin USING (true) WITH CHECK (true);

-- Same Citizen core-identity column set every other office role gets --
-- resolvePerson()'s cross-office duplicate detection needs it, never the
-- encrypted SSS/GSIS/PhilHealth columns. INSERT list already includes
-- created_at/is_archived (the column list every other office role's grant
-- needed a follow-up fix migration to add -- see 20260827023514 and
-- 20260827100200 -- because Prisma Client sends explicit values for every
-- client-computable @default on every INSERT).
GRANT SELECT (
  person_key, person_parent_key, person_sub_parent_key, person_is_head, person_relation_to_head,
  person_lname, person_fname, person_mname, person_street, person_brgy_code,
  person_sex, person_gender, person_bdate, person_civil_status, person_religion,
  person_educ_level, person_educ_course, person_occupation, person_occupation_industry,
  person_occupation_bus_name, person_occupation_bus_address,
  created_at, updated_at, created_by, updated_by, is_archived
), INSERT (
  person_parent_key, person_sub_parent_key, person_is_head, person_relation_to_head,
  person_lname, person_fname, person_mname, person_street, person_brgy_code,
  person_sex, person_gender, person_bdate, person_civil_status, person_religion,
  person_educ_level, person_educ_course, person_occupation, person_occupation_industry,
  person_occupation_bus_name, person_occupation_bus_address,
  updated_at, created_by, updated_by, created_at, is_archived
), UPDATE (
  person_parent_key, person_sub_parent_key, person_is_head, person_relation_to_head,
  person_lname, person_fname, person_mname, person_street, person_brgy_code,
  person_sex, person_gender, person_bdate, person_civil_status, person_religion,
  person_educ_level, person_educ_course, person_occupation, person_occupation_industry,
  person_occupation_bus_name, person_occupation_bus_address,
  updated_at, updated_by, is_archived
) ON "Citizen" TO office_staff;

GRANT SELECT ON "barangay" TO office_staff;
GRANT SELECT ON "app_setting" TO office_staff;
GRANT INSERT ON "audit_log" TO office_staff;

-- resolvePerson()'s needs_review path (any office) inserts here.
GRANT INSERT ON "duplicate_review_queue_item" TO office_staff;
