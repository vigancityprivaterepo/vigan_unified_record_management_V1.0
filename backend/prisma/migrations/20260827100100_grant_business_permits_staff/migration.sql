-- RBAC role + grants for the new business_permits_staff office, mirroring
-- the Phase 3 RBAC migration's shape exactly for the existing three office
-- roles. Split from 20260827100000 only because that migration ADD VALUE's
-- the enum this one doesn't need to touch at all -- this file would be
-- safe to merge into that one, but keeping the pattern of "schema in one
-- migration, RBAC grants in the next" consistent with
-- grant_duplicate_review_queue's split from add_duplicate_review_queue.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'business_permits_staff') THEN
    CREATE ROLE business_permits_staff LOGIN PASSWORD 'changeme_provision_immediately';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO business_permits_staff', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO business_permits_staff;

GRANT SELECT, INSERT, UPDATE ON "Business_Permit" TO business_permits_staff;
GRANT SELECT, INSERT, UPDATE ON "Business_Permit" TO admin;

ALTER TABLE "Business_Permit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_permit_business_permits_staff ON "Business_Permit" FOR ALL TO business_permits_staff USING (true) WITH CHECK (true);
CREATE POLICY business_permit_admin ON "Business_Permit" FOR ALL TO admin USING (true) WITH CHECK (true);

-- Same Citizen core-identity column set every other office role gets --
-- resolvePerson()'s cross-office duplicate detection needs it, never the
-- encrypted SSS/GSIS/PhilHealth columns.
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
  updated_at, created_by, updated_by
), UPDATE (
  person_parent_key, person_sub_parent_key, person_is_head, person_relation_to_head,
  person_lname, person_fname, person_mname, person_street, person_brgy_code,
  person_sex, person_gender, person_bdate, person_civil_status, person_religion,
  person_educ_level, person_educ_course, person_occupation, person_occupation_industry,
  person_occupation_bus_name, person_occupation_bus_address,
  updated_at, updated_by, is_archived
) ON "Citizen" TO business_permits_staff;

GRANT SELECT ON "barangay" TO business_permits_staff;
GRANT SELECT ON "app_setting" TO business_permits_staff;
GRANT INSERT ON "audit_log" TO business_permits_staff;

-- resolvePerson()'s needs_review path (any office) inserts here.
GRANT INSERT ON "duplicate_review_queue_item" TO business_permits_staff;
