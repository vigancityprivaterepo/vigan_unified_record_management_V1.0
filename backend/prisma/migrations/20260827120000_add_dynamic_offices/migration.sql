-- Admin-configurable offices. Two-step, same reason as the business-permit
-- migration split (20260827100000 / 20260827100100): a newly ADD VALUE'd
-- enum member can't be used as data inside the same transaction that added
-- it, and Prisma wraps each migration.sql in one transaction. This
-- migration only adds the enum value and creates tables/columns; the
-- office_staff Postgres role (whose name IS that enum value) is created in
-- the next migration.
ALTER TYPE "StaffRole" ADD VALUE 'office_staff';

CREATE TYPE "OfficeFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

CREATE TABLE "office" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "office_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "office_slug_key" ON "office"("slug");

CREATE TABLE "office_form_field" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "office_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "OfficeFieldType" NOT NULL,
    "options" TEXT[],
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "office_form_field_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "office_form_field_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "office"("id")
);

CREATE UNIQUE INDEX "office_form_field_office_id_key_key" ON "office_form_field"("office_id", "key");
CREATE INDEX "office_form_field_office_id_idx" ON "office_form_field"("office_id");

CREATE TABLE "office_record" (
    "record_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "office_id" UUID NOT NULL,
    "person_key" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "office_record_pkey" PRIMARY KEY ("record_key"),
    CONSTRAINT "office_record_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "office"("id"),
    CONSTRAINT "office_record_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key")
);

CREATE INDEX "office_record_office_id_idx" ON "office_record"("office_id");
CREATE INDEX "office_record_person_key_idx" ON "office_record"("person_key");

ALTER TABLE "staff_account" ADD COLUMN "office_id" UUID;
ALTER TABLE "staff_account" ADD CONSTRAINT "staff_account_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "office"("id");
