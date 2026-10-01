-- Whether a module collects a person's identity (name/birthdate + the
-- collect_sex/civil_status/street/barangay block) at all, for a module
-- that isn't about a person -- e.g. an Assessor's Office "Lots" module,
-- which is about land, not people. Off means the module's records carry
-- no person_key and no unresolved_person, only its own custom fields.
-- Defaults true so every existing module keeps working exactly as before.
ALTER TABLE "office_module" ADD COLUMN "collect_person_info" BOOLEAN NOT NULL DEFAULT true;
