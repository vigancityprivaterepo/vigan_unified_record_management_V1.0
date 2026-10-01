-- Phase 3: RBAC roles + Postgres-level RLS, plus the connect-pg-simple
-- session store table.
--
-- Five real LOGIN roles, distinct from the migration-owner role ("vigan",
-- a Postgres superuser used only for `prisma migrate`, never for regular
-- app queries):
--   cswd_staff, agri_staff, civil_registry_staff, admin  -- citizen-domain
--     data, scoped per the RBAC matrix below.
--   app_service                                          -- auth-subsystem
--     only (staff_account lookup, session store, login/logout audit
--     inserts). Zero access to Citizen/satellite/audit-read data -- an app
--     bug in the login/session code path can't leak citizen data.
--
-- Passwords below are placeholders. `npm run db:provision-roles` (backend/
-- scripts/provisionDbRoles.ts) ALTERs them from Docker secrets immediately
-- after migrating -- see docker/secrets/README.md. Never leave a database
-- reachable on the placeholder passwords.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cswd_staff') THEN
    CREATE ROLE cswd_staff LOGIN PASSWORD 'changeme_provision_immediately';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agri_staff') THEN
    CREATE ROLE agri_staff LOGIN PASSWORD 'changeme_provision_immediately';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'civil_registry_staff') THEN
    CREATE ROLE civil_registry_staff LOGIN PASSWORD 'changeme_provision_immediately';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin') THEN
    CREATE ROLE admin LOGIN PASSWORD 'changeme_provision_immediately';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_service') THEN
    CREATE ROLE app_service LOGIN PASSWORD 'changeme_provision_immediately';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO cswd_staff, agri_staff, civil_registry_staff, admin, app_service',
    current_database()
  );
END $$;

GRANT USAGE ON SCHEMA public TO cswd_staff, agri_staff, civil_registry_staff, admin, app_service;

-- --- Satellite tables: each office role gets its own table(s) only --------

GRANT SELECT, INSERT, UPDATE ON "Persons_Senior", "Persons_PWD", "Persons_Solo_Parent" TO cswd_staff;
GRANT SELECT, INSERT, UPDATE ON "Persons_Farmer" TO agri_staff;
GRANT SELECT, INSERT, UPDATE ON "Person_Birth", "Person_Death" TO civil_registry_staff;

-- admin sees/edits every office's satellite data (Citizen 360 / duplicate
-- review / merge).
GRANT SELECT, INSERT, UPDATE ON
  "Persons_Senior", "Persons_PWD", "Persons_Solo_Parent", "Persons_Farmer", "Person_Birth", "Person_Death"
  TO admin;

-- RLS as defense-in-depth on top of the table grants above: even a
-- mistaken future GRANT of, say, Persons_Farmer to cswd_staff still
-- wouldn't expose rows, because RLS denies by default for any role with no
-- matching policy. The table owner ("vigan") is a Postgres superuser and
-- always bypasses RLS, so migrations/seed/existing tooling are unaffected.

ALTER TABLE "Persons_Senior" ENABLE ROW LEVEL SECURITY;
CREATE POLICY persons_senior_cswd_staff ON "Persons_Senior" FOR ALL TO cswd_staff USING (true) WITH CHECK (true);
CREATE POLICY persons_senior_admin ON "Persons_Senior" FOR ALL TO admin USING (true) WITH CHECK (true);

ALTER TABLE "Persons_PWD" ENABLE ROW LEVEL SECURITY;
CREATE POLICY persons_pwd_cswd_staff ON "Persons_PWD" FOR ALL TO cswd_staff USING (true) WITH CHECK (true);
CREATE POLICY persons_pwd_admin ON "Persons_PWD" FOR ALL TO admin USING (true) WITH CHECK (true);

ALTER TABLE "Persons_Solo_Parent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY persons_solo_parent_cswd_staff ON "Persons_Solo_Parent" FOR ALL TO cswd_staff USING (true) WITH CHECK (true);
CREATE POLICY persons_solo_parent_admin ON "Persons_Solo_Parent" FOR ALL TO admin USING (true) WITH CHECK (true);

ALTER TABLE "Persons_Farmer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY persons_farmer_agri_staff ON "Persons_Farmer" FOR ALL TO agri_staff USING (true) WITH CHECK (true);
CREATE POLICY persons_farmer_admin ON "Persons_Farmer" FOR ALL TO admin USING (true) WITH CHECK (true);

ALTER TABLE "Person_Birth" ENABLE ROW LEVEL SECURITY;
CREATE POLICY person_birth_civil_registry_staff ON "Person_Birth" FOR ALL TO civil_registry_staff USING (true) WITH CHECK (true);
CREATE POLICY person_birth_admin ON "Person_Birth" FOR ALL TO admin USING (true) WITH CHECK (true);

ALTER TABLE "Person_Death" ENABLE ROW LEVEL SECURITY;
CREATE POLICY person_death_civil_registry_staff ON "Person_Death" FOR ALL TO civil_registry_staff USING (true) WITH CHECK (true);
CREATE POLICY person_death_admin ON "Person_Death" FOR ALL TO admin USING (true) WITH CHECK (true);

-- --- Citizen: shared master identity, restricted by COLUMN not row -------
-- Every office must see/write core identity columns for ALL citizens
-- (resolvePerson()'s cross-office duplicate detection requires it) but
-- never the encrypted SSS/GSIS/PhilHealth columns -- admin only. No RLS
-- here: row-level restriction would break cross-office identity resolution.

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
) ON "Citizen" TO cswd_staff, agri_staff, civil_registry_staff;

-- admin: every column, including the encrypted ones.
GRANT SELECT, INSERT, UPDATE ON "Citizen" TO admin;

-- --- Reference / config tables ---------------------------------------------

GRANT SELECT ON "barangay" TO cswd_staff, agri_staff, civil_registry_staff, admin;
GRANT SELECT, INSERT, UPDATE ON "barangay" TO admin;

GRANT SELECT ON "app_setting" TO cswd_staff, agri_staff, civil_registry_staff, admin;
GRANT INSERT, UPDATE ON "app_setting" TO admin;

-- --- Audit log: append-only, admin-read-only --------------------------------
-- Every office role (and app_service, for login/logout events) can INSERT
-- its own audit rows. Only admin can SELECT. UPDATE/DELETE is granted to
-- NO role at all -- that, not the REVOKE below, is what actually makes this
-- append-only. The REVOKE is an explicit, self-documenting guarantee, not
-- the mechanism itself: a future migration must GRANT UPDATE/DELETE
-- explicitly (and should never do so) for this to ever change.

GRANT INSERT ON "audit_log" TO cswd_staff, agri_staff, civil_registry_staff, admin, app_service;
GRANT SELECT ON "audit_log" TO admin;
REVOKE UPDATE, DELETE ON "audit_log" FROM PUBLIC;

-- --- Auth subsystem: app_service only, zero citizen-data access ------------

GRANT SELECT ON "staff_account" TO app_service;

-- connect-pg-simple's expected session-store schema (documented in its
-- README) -- not part of the Prisma-modeled schema since Prisma Client
-- never touches it directly.
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
) WITH (OIDS = FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO app_service;
