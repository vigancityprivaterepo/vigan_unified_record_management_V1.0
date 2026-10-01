-- Unifies every office -- CSWD, Agriculture, and Civil Registry included --
-- onto the generic Office/OfficeModule/OfficeFormField/OfficeRecord system
-- admin-created offices already used, per explicit product decision to
-- remove the three original offices' dedicated tables and Postgres roles
-- entirely. Adds one new layer, OfficeModule, between Office and
-- OfficeFormField/OfficeRecord: most offices have exactly one module, but
-- CSWD needs three (Senior, PWD, Solo Parent) and Civil Registry needs two
-- (Birth, Death) under a single login, matching what those offices already
-- had as separate forms.
--
-- Every existing row is migrated, not dropped: the six satellite tables'
-- data becomes office_record rows under new CSWD/Agriculture/Civil Registry
-- offices and their modules; existing dynamic offices each get one
-- "default" module so their data keeps working structurally unchanged;
-- cswd_staff/agri_staff/civil_registry_staff StaffAccount rows become
-- office_staff scoped to the matching new office.

-- === 1. Schema additions (nullable first, backfilled below, then locked down) ===

ALTER TYPE "OfficeFieldType" ADD VALUE 'FILE';

CREATE TABLE "office_module" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "office_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "requires_citizen_link" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "office_module_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "office_module_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "office"("id")
);
CREATE UNIQUE INDEX "office_module_office_id_slug_key" ON "office_module"("office_id", "slug");

ALTER TABLE "office_form_field" ADD COLUMN "module_id" UUID;
ALTER TABLE "office_record" ADD COLUMN "module_id" UUID;
ALTER TABLE "office_record" ADD COLUMN "unresolved_person" JSONB;
ALTER TABLE "office_record" ALTER COLUMN "person_key" DROP NOT NULL;
ALTER TABLE "dashboard_widget" ADD COLUMN "source_module_id" UUID;
ALTER TABLE "duplicate_review_queue_item" ADD COLUMN "module_id" UUID;

-- === 2. Data migration ===

DO $$
DECLARE
  cswd_office_id UUID;
  agri_office_id UUID;
  civilreg_office_id UUID;
  senior_module_id UUID;
  pwd_module_id UUID;
  solo_parent_module_id UUID;
  farmer_module_id UUID;
  birth_module_id UUID;
  death_module_id UUID;
  r RECORD;
  default_module_id UUID;
BEGIN
  -- 2a. One "default" module per pre-existing dynamic office, named after
  -- the office itself -- these offices only ever had one form, so this
  -- keeps their data working with no visible change.
  FOR r IN SELECT id, name FROM "office" LOOP
    INSERT INTO "office_module" (id, office_id, name, slug, requires_citizen_link, sort_order)
    VALUES (gen_random_uuid(), r.id, r.name, 'default', true, 0)
    RETURNING id INTO default_module_id;

    UPDATE "office_form_field" SET module_id = default_module_id WHERE office_id = r.id;
    UPDATE "office_record" SET module_id = default_module_id WHERE office_id = r.id;
  END LOOP;

  -- 2b. The three original offices, each with their former forms as named
  -- modules.
  INSERT INTO "office" (id, name, slug, description, created_at, updated_at)
  VALUES (gen_random_uuid(), 'CSWD', 'cswd', 'City Social Welfare and Development Office', now(), now())
  RETURNING id INTO cswd_office_id;

  INSERT INTO "office" (id, name, slug, description, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Agriculture', 'agriculture', 'City Agriculture Office', now(), now())
  RETURNING id INTO agri_office_id;

  INSERT INTO "office" (id, name, slug, description, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Civil Registry', 'civil_registry', 'City Civil Registry Office', now(), now())
  RETURNING id INTO civilreg_office_id;

  INSERT INTO "office_module" (id, office_id, name, slug, requires_citizen_link, sort_order)
  VALUES (gen_random_uuid(), cswd_office_id, 'Senior Citizen', 'senior', true, 0)
  RETURNING id INTO senior_module_id;

  INSERT INTO "office_module" (id, office_id, name, slug, requires_citizen_link, sort_order)
  VALUES (gen_random_uuid(), cswd_office_id, 'PWD', 'pwd', true, 1)
  RETURNING id INTO pwd_module_id;

  INSERT INTO "office_module" (id, office_id, name, slug, requires_citizen_link, sort_order)
  VALUES (gen_random_uuid(), cswd_office_id, 'Solo Parent', 'solo_parent', true, 2)
  RETURNING id INTO solo_parent_module_id;

  INSERT INTO "office_module" (id, office_id, name, slug, requires_citizen_link, sort_order)
  VALUES (gen_random_uuid(), agri_office_id, 'Farmer', 'farmer', true, 0)
  RETURNING id INTO farmer_module_id;

  -- Birth is the one module that may stand alone with no Citizen link --
  -- families passing through Vigan without residing here still get the
  -- birth recorded.
  INSERT INTO "office_module" (id, office_id, name, slug, requires_citizen_link, sort_order)
  VALUES (gen_random_uuid(), civilreg_office_id, 'Birth', 'birth', false, 0)
  RETURNING id INTO birth_module_id;

  INSERT INTO "office_module" (id, office_id, name, slug, requires_citizen_link, sort_order)
  VALUES (gen_random_uuid(), civilreg_office_id, 'Death', 'death', true, 1)
  RETURNING id INTO death_module_id;

  -- 2c. Repoint the custom fields already added to these six forms (the
  -- "add custom fields to the built-in offices" feature) from form_kind to
  -- the matching new module.
  UPDATE "office_form_field" SET module_id = senior_module_id WHERE form_kind = 'senior';
  UPDATE "office_form_field" SET module_id = pwd_module_id WHERE form_kind = 'pwd';
  UPDATE "office_form_field" SET module_id = solo_parent_module_id WHERE form_kind = 'solo_parent';
  UPDATE "office_form_field" SET module_id = farmer_module_id WHERE form_kind = 'farmer';
  UPDATE "office_form_field" SET module_id = birth_module_id WHERE form_kind = 'birth';
  UPDATE "office_form_field" SET module_id = death_module_id WHERE form_kind = 'death';

  -- 2d. Migrate every satellite table's rows into office_record, folding
  -- each table's named columns plus its extra_data JSONB into one `data`
  -- blob keyed the same way a dynamic office's submissions already are.
  INSERT INTO "office_record" (record_key, module_id, person_key, data, is_archived, created_at, updated_at, created_by, updated_by)
  SELECT sn_key, senior_module_id, person_key,
         jsonb_build_object('snCommorbidity', sn_commorbidity, 'snIsHaveId', sn_is_have_id) || COALESCE(extra_data, '{}'::jsonb),
         is_archived, created_at, updated_at, created_by, updated_by
  FROM "Persons_Senior";

  INSERT INTO "office_record" (record_key, module_id, person_key, data, is_archived, created_at, updated_at, created_by, updated_by)
  SELECT pwd_key, pwd_module_id, person_key,
         jsonb_build_object('pwdTypeOfDisability', pwd_type_of_disability, 'pwdCommorbidity', pwd_commorbidity, 'pwdIsHaveId', pwd_is_have_id) || COALESCE(extra_data, '{}'::jsonb),
         is_archived, created_at, updated_at, created_by, updated_by
  FROM "Persons_PWD";

  INSERT INTO "office_record" (record_key, module_id, person_key, data, is_archived, created_at, updated_at, created_by, updated_by)
  SELECT sp_key, solo_parent_module_id, person_key,
         jsonb_build_object('spNumberOfChildren', sp_number_of_children, 'spIsHaveId', sp_is_have_id) || COALESCE(extra_data, '{}'::jsonb),
         is_archived, created_at, updated_at, created_by, updated_by
  FROM "Persons_Solo_Parent";

  INSERT INTO "office_record" (record_key, module_id, person_key, data, is_archived, created_at, updated_at, created_by, updated_by)
  SELECT farmer_key, farmer_module_id, person_key,
         jsonb_build_object('farmerIsSenior', farmer_is_senior, 'farmerIsPwd', farmer_is_pwd, 'farmerLocationOfFarm', farmer_location_of_farm, 'farmerSizeOfFarm', farmer_size_of_farm) || COALESCE(extra_data, '{}'::jsonb),
         is_archived, created_at, updated_at, created_by, updated_by
  FROM "Persons_Farmer";

  INSERT INTO "office_record" (record_key, module_id, person_key, data, is_archived, created_at, updated_at, created_by, updated_by)
  SELECT death_key, death_module_id, person_key,
         jsonb_build_object('deathDdate', death_ddate, 'deathPlaceOfDeath', death_place_of_death, 'deathCauseOfDeath', death_cause_of_death) || COALESCE(extra_data, '{}'::jsonb),
         is_archived, created_at, updated_at, created_by, updated_by
  FROM "Person_Death";

  -- Birth: the only table with a nullable person_key -- when null, its own
  -- name/bdate columns (the only place that data lived, with no Citizen
  -- row to read them from) move into unresolved_person instead of data.
  INSERT INTO "office_record" (record_key, module_id, person_key, unresolved_person, data, is_archived, created_at, updated_at, created_by, updated_by)
  SELECT birth_key, birth_module_id, person_key,
         CASE WHEN person_key IS NULL THEN
           jsonb_build_object('lname', birth_lname, 'fname', birth_fname, 'mname', birth_mname, 'bdate', birth_bdate)
         ELSE NULL END,
         jsonb_build_object(
           'birthBplace', birth_bplace, 'birthMother', birth_mother, 'birthFather', birth_father,
           'birthOrder', birth_order, 'birthIsFromVigan', birth_is_from_vigan, 'birthUploadDoc', birth_upload_doc
         ) || COALESCE(extra_data, '{}'::jsonb),
         is_archived, created_at, updated_at, created_by, updated_by
  FROM "Person_Birth";

  -- 2e. Any already-saved dashboard widgets built against the old fixed
  -- sources or a dynamic office now point at the matching module.
  UPDATE "dashboard_widget" SET source_module_id = senior_module_id WHERE source_kind = 'senior';
  UPDATE "dashboard_widget" SET source_module_id = pwd_module_id WHERE source_kind = 'pwd';
  UPDATE "dashboard_widget" SET source_module_id = solo_parent_module_id WHERE source_kind = 'solo_parent';
  UPDATE "dashboard_widget" SET source_module_id = farmer_module_id WHERE source_kind = 'farmer';
  UPDATE "dashboard_widget" SET source_module_id = birth_module_id WHERE source_kind = 'birth';
  UPDATE "dashboard_widget" SET source_module_id = death_module_id WHERE source_kind = 'death';
  UPDATE "dashboard_widget" w
  SET source_module_id = m.id
  FROM "office_module" m
  WHERE w.source_kind = 'office' AND w.source_office_id = m.office_id AND m.slug = 'default';

  -- 2f. Any still-pending duplicate review items -- same field-name mapping
  -- as 2d, but into the queue's flat {lname, fname, mname, bdate, fields}
  -- shape (customFields folded into fields) instead of office_record's
  -- {data}, since that's what materializeQueuedIntake now expects for
  -- every module uniformly.
  UPDATE "duplicate_review_queue_item"
  SET module_id = CASE office_table
        WHEN 'Persons_Senior' THEN senior_module_id
        WHEN 'Persons_PWD' THEN pwd_module_id
        WHEN 'Persons_Solo_Parent' THEN solo_parent_module_id
        WHEN 'Persons_Farmer' THEN farmer_module_id
        WHEN 'Person_Birth' THEN birth_module_id
        WHEN 'Person_Death' THEN death_module_id
      END,
      candidate_data = jsonb_build_object(
        'lname', candidate_data->>'lname',
        'fname', candidate_data->>'fname',
        'mname', candidate_data->>'mname',
        'bdate', candidate_data->>'bdate',
        'fields', (candidate_data - 'lname' - 'fname' - 'mname' - 'bdate' - 'customFields') || COALESCE(candidate_data->'customFields', '{}'::jsonb)
      )
  WHERE office_table IN ('Persons_Senior', 'Persons_PWD', 'Persons_Solo_Parent', 'Persons_Farmer', 'Person_Birth', 'Person_Death');

  UPDATE "duplicate_review_queue_item" q
  SET module_id = m.id,
      candidate_data = jsonb_build_object(
        'lname', candidate_data->>'lname',
        'fname', candidate_data->>'fname',
        'mname', candidate_data->>'mname',
        'bdate', candidate_data->>'bdate',
        'fields', COALESCE(candidate_data->'fields', '{}'::jsonb)
      )
  FROM "office_module" m
  WHERE q.office_table = 'OfficeRecord'
    AND m.office_id = (candidate_data->>'officeId')::uuid
    AND m.slug = 'default';

  -- 2g. cswd_staff/agri_staff/civil_registry_staff accounts become
  -- office_staff scoped to the matching new office -- they'll see every
  -- module under it (e.g. cswd.demo sees Senior/PWD/Solo Parent tabs).
  UPDATE "staff_account" SET role = 'office_staff', office_id = cswd_office_id WHERE role = 'cswd_staff';
  UPDATE "staff_account" SET role = 'office_staff', office_id = agri_office_id WHERE role = 'agri_staff';
  UPDATE "staff_account" SET role = 'office_staff', office_id = civilreg_office_id WHERE role = 'civil_registry_staff';
END $$;

-- === 3. Lock down the new columns now that every row has a value ===

ALTER TABLE "office_form_field" ALTER COLUMN "module_id" SET NOT NULL;
ALTER TABLE "office_record" ALTER COLUMN "module_id" SET NOT NULL;
ALTER TABLE "dashboard_widget" ALTER COLUMN "source_module_id" SET NOT NULL;
ALTER TABLE "duplicate_review_queue_item" ALTER COLUMN "module_id" SET NOT NULL;

-- === 4. Drop the old officeId/formKind/sourceKind/officeTable shape ===

DROP INDEX IF EXISTS "office_form_field_office_id_key_key";
DROP INDEX IF EXISTS "office_form_field_form_kind_key_key";
ALTER TABLE "office_form_field" DROP CONSTRAINT IF EXISTS "office_form_field_office_or_form_kind_check";
ALTER TABLE "office_form_field" DROP CONSTRAINT IF EXISTS "office_form_field_office_id_fkey";
ALTER TABLE "office_form_field" DROP COLUMN "office_id";
ALTER TABLE "office_form_field" DROP COLUMN "form_kind";
ALTER TABLE "office_form_field" ADD CONSTRAINT "office_form_field_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "office_module"("id");
CREATE UNIQUE INDEX "office_form_field_module_id_key_key" ON "office_form_field"("module_id", "key");
CREATE INDEX "office_form_field_module_id_idx" ON "office_form_field"("module_id");

ALTER TABLE "office_record" DROP CONSTRAINT IF EXISTS "office_record_office_id_fkey";
DROP INDEX IF EXISTS "office_record_office_id_idx";
ALTER TABLE "office_record" DROP COLUMN "office_id";
ALTER TABLE "office_record" ADD CONSTRAINT "office_record_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "office_module"("id");
CREATE INDEX "office_record_module_id_idx" ON "office_record"("module_id");

ALTER TABLE "dashboard_widget" DROP CONSTRAINT IF EXISTS "dashboard_widget_source_office_id_fkey";
ALTER TABLE "dashboard_widget" DROP COLUMN "source_kind";
ALTER TABLE "dashboard_widget" DROP COLUMN "source_office_id";
ALTER TABLE "dashboard_widget" ADD CONSTRAINT "dashboard_widget_source_module_id_fkey" FOREIGN KEY ("source_module_id") REFERENCES "office_module"("id");

ALTER TABLE "duplicate_review_queue_item" DROP COLUMN "office_table";

-- === 5. Drop the six original satellite tables -- fully migrated above ===

DROP TABLE "Persons_Senior";
DROP TABLE "Persons_PWD";
DROP TABLE "Persons_Solo_Parent";
DROP TABLE "Persons_Farmer";
DROP TABLE "Person_Birth";
DROP TABLE "Person_Death";

-- === 6. Drop the three per-office Postgres roles -- office_staff (already ===
-- granted office/office_form_field/office_record/barangay/app_setting/
-- audit_log/duplicate_review_queue_item access) covers every office now.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM cswd_staff, agri_staff, civil_registry_staff;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM cswd_staff, agri_staff, civil_registry_staff;
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM cswd_staff, agri_staff, civil_registry_staff', current_database());
END $$;
DROP ROLE IF EXISTS cswd_staff;
DROP ROLE IF EXISTS agri_staff;
DROP ROLE IF EXISTS civil_registry_staff;

-- === 7. Shrink StaffRole to admin/office_staff -- no ALTER TYPE ... DROP ===
-- VALUE in Postgres, so this recreates the type without them (same
-- technique 20260827110000_remove_business_permits_office already used for
-- business_permits_staff). Every staff_account row was migrated off these
-- roles in step 2g above, so the USING cast below can't fail.

CREATE TYPE "StaffRole_new" AS ENUM ('admin', 'office_staff');
ALTER TABLE "staff_account" ALTER COLUMN "role" TYPE "StaffRole_new" USING (role::text::"StaffRole_new");
DROP TYPE "StaffRole";
ALTER TYPE "StaffRole_new" RENAME TO "StaffRole";

-- === 8. Grant office_staff/admin access to the new office_module table ===

GRANT SELECT ON "office_module" TO office_staff;
GRANT SELECT, INSERT, UPDATE ON "office_module" TO admin;
