-- Indexes for the lookups the app makes most, sized for a city-scale
-- registry (about 50,000 citizens). Measured on a copy at that size.

-- "Is this person in program X" (program gaps, outreach, the dots on the
-- Citizens list, a citizen's profile), answered from the index alone.
CREATE INDEX "office_record_person_module_active_idx" ON "office_record" ("person_key", "module_id") WHERE NOT "is_archived";

-- A program's records newest first, and its counts by month.
CREATE INDEX "office_record_module_created_active_idx" ON "office_record" ("module_id", "created_at" DESC) WHERE NOT "is_archived";

-- A household's members (every household page counts and lists them).
CREATE INDEX "Citizen_person_parent_key_idx" ON "Citizen" ("person_parent_key");

-- Everything filtered or grouped by barangay.
CREATE INDEX "Citizen_person_brgy_code_idx" ON "Citizen" ("person_brgy_code");
