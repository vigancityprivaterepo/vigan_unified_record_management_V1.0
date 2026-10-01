-- Lets admin add custom fields to the six original offices' forms (Senior,
-- PWD, Solo Parent, Farmer, Birth, Death) the same way it already can for
-- admin-created dynamic offices -- WITHOUT migrating those offices onto the
-- generic Office/OfficeRecord tables or the shared office_staff role. Their
-- dedicated Postgres roles, tables, and existing grants are untouched by
-- this migration; the only change to those six tables is one new nullable
-- JSONB column each, already covered by those roles' existing whole-table
-- GRANT SELECT/INSERT/UPDATE (Phase 3 RBAC migration), so no new GRANTs are
-- needed here.
ALTER TABLE "office_form_field" ALTER COLUMN "office_id" DROP NOT NULL;
ALTER TABLE "office_form_field" ADD COLUMN "form_kind" TEXT;

ALTER TABLE "office_form_field" ADD CONSTRAINT "office_form_field_office_or_form_kind_check"
  CHECK (("office_id" IS NOT NULL) <> ("form_kind" IS NOT NULL));

CREATE UNIQUE INDEX "office_form_field_form_kind_key_key" ON "office_form_field"("form_kind", "key");

ALTER TABLE "Persons_Senior" ADD COLUMN "extra_data" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Persons_PWD" ADD COLUMN "extra_data" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Persons_Solo_Parent" ADD COLUMN "extra_data" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Persons_Farmer" ADD COLUMN "extra_data" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Person_Birth" ADD COLUMN "extra_data" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Person_Death" ADD COLUMN "extra_data" JSONB NOT NULL DEFAULT '{}'::jsonb;
