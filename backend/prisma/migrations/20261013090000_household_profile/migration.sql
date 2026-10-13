-- A household's living conditions (water, toilet, electricity, housing):
-- the items CBMS records per household. One row per household, attached to
-- its head; services/householdProfile.ts moves the row when the head changes.
-- Answers are short codes checked in the app, not here, so the list can be
-- matched to a CBMS export without a migration. `source` and `as_of` say
-- where the answers came from and how old they are.
CREATE TABLE "household_profile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "head_person_key" UUID NOT NULL,
    "water_source" TEXT,
    "drinking_water" TEXT,
    "toilet_facility" TEXT,
    "electricity" TEXT,
    "tenure_status" TEXT,
    "housing_type" TEXT,
    "roof_material" TEXT,
    "wall_material" TEXT,
    "internet_access" TEXT,
    "source" TEXT NOT NULL DEFAULT 'office',
    "as_of" DATE NOT NULL DEFAULT CURRENT_DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "household_profile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "household_profile_head_person_key_fkey" FOREIGN KEY ("head_person_key") REFERENCES "Citizen"("person_key") ON DELETE CASCADE,
    CONSTRAINT "household_profile_source_check" CHECK ("source" IN ('office', 'cbms'))
);
CREATE UNIQUE INDEX "household_profile_head_person_key_key" ON "household_profile" ("head_person_key");

-- Admin edits it on the Households page. Office staff only move it to the
-- new head when they record a death (services/deathEffects.ts).
GRANT SELECT, INSERT, UPDATE, DELETE ON "household_profile" TO admin;
GRANT SELECT, UPDATE ON "household_profile" TO office_staff;
