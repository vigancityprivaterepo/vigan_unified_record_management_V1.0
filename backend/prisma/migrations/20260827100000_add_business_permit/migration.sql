-- First office added beyond the original three (CSWD, Agriculture, Civil
-- Registry): Business Permits/Licensing. Two-step, same reason the RBAC
-- role/grants live in a separate follow-up migration (20260827100100): a
-- newly ADD VALUE'd enum member can't be used (written as data) inside the
-- same transaction that added it, and Prisma wraps each migration.sql in
-- one transaction. This migration only adds the enum value and creates the
-- table -- neither touches the new value as data.
ALTER TYPE "StaffRole" ADD VALUE 'business_permits_staff';

CREATE TABLE "Business_Permit" (
    "permit_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "business_type" TEXT,
    "business_address" TEXT,
    "permit_number" TEXT,
    "date_issued" DATE,
    "expiry_date" DATE,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "Business_Permit_pkey" PRIMARY KEY ("permit_key"),
    CONSTRAINT "Business_Permit_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key")
);

CREATE UNIQUE INDEX "Business_Permit_permit_number_key" ON "Business_Permit"("permit_number");
CREATE INDEX "Business_Permit_person_key_idx" ON "Business_Permit"("person_key");
