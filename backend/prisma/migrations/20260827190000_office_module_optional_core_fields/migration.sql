-- Per-module toggle for the optional part of the core intake block (sex,
-- civil status, street, barangay) -- last/first/middle name + birthdate
-- stay mandatory on every module (resolvePerson() needs them), never
-- gated by these. Defaults true so every existing module keeps collecting
-- exactly what it already did.
ALTER TABLE "office_module" ADD COLUMN "collect_sex" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "office_module" ADD COLUMN "collect_civil_status" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "office_module" ADD COLUMN "collect_street" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "office_module" ADD COLUMN "collect_barangay" BOOLEAN NOT NULL DEFAULT true;
