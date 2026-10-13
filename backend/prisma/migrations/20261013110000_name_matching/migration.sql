-- Matching people whose names are typed differently, and finding the
-- duplicates already in the registry (services/resolvePerson.ts,
-- services/duplicateCitizens.ts).

-- A name reduced to what identifies it: capitals, no accents, punctuation or
-- spaces, the usual abbreviations spelled out and no JR/SR/II. "Ma. Cristina",
-- "MARIA CRISTINA" and "Maria-Cristina" give the same key; so do "Dela Cruz"
-- and "DE LA CRUZ". Kept in step with nameKey() in src/lib/nameKey.ts.
CREATE FUNCTION name_key(name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(translate(upper(name), 'ÑñÁáÉéÍíÓóÚúÜü', 'NNAAEEIIOOUUUU'), '[^A-Z0-9]+', ' ', 'g'),
      '\m(JR|SR|II|III|IV)\M', '', 'g'),
      '\mMA\M', 'MARIA', 'g'),
      '\mSTA\M', 'SANTA', 'g'),
      '\mSTO\M', 'SANTO', 'g'),
    ' ', '')
$$;

-- The exact-match lookup every registration and import makes.
CREATE INDEX "citizen_name_key_idx" ON "Citizen" (name_key("person_lname"), name_key("person_fname"), "person_bdate") WHERE NOT "is_archived";
-- Possible duplicates are looked for among people born the same day.
CREATE INDEX "citizen_bdate_active_idx" ON "Citizen" ("person_bdate") WHERE NOT "is_archived";

-- Two citizens the administrator looked at and said are different people
-- (twins, a parent and child with the same name), so the possible-duplicates
-- list stops showing them. person_a is always the smaller key.
CREATE TABLE "citizen_distinct_pair" (
    "person_a" UUID NOT NULL,
    "person_b" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by" UUID,

    CONSTRAINT "citizen_distinct_pair_pkey" PRIMARY KEY ("person_a", "person_b"),
    CONSTRAINT "citizen_distinct_pair_person_a_fkey" FOREIGN KEY ("person_a") REFERENCES "Citizen"("person_key") ON DELETE CASCADE,
    CONSTRAINT "citizen_distinct_pair_person_b_fkey" FOREIGN KEY ("person_b") REFERENCES "Citizen"("person_key") ON DELETE CASCADE,
    CONSTRAINT "citizen_distinct_pair_order_check" CHECK ("person_a" < "person_b")
);
CREATE INDEX "citizen_distinct_pair_person_b_idx" ON "citizen_distinct_pair" ("person_b");

GRANT SELECT, INSERT, DELETE ON "citizen_distinct_pair" TO admin;
