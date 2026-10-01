-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- Trigram index backing resolvePerson()'s fuzzy-match step (Phase 2).
CREATE INDEX "citizen_lname_fname_trgm_idx" ON "Citizen"
  USING gin ((lower(person_lname) || ' ' || lower(person_fname)) gin_trgm_ops);

-- Default runtime config -- resolvePerson() falls back to these values in
-- code if a row is ever deleted, but seed them so `migrate deploy` alone
-- (no separate `db seed`) leaves the system in a working state.
INSERT INTO "app_setting" ("key", "value", "updated_at") VALUES
  ('FUZZY_MATCH_THRESHOLD', '0.6', now()),
  ('FUZZY_MATCH_BDATE_TOLERANCE_DAYS', '5', now())
ON CONFLICT ("key") DO NOTHING;
