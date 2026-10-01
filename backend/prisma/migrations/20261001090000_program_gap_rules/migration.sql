-- Program gaps: rules that find citizens who qualify for a program but are
-- not on it ('missing'), or who are on a list they should no longer be on
-- ('conflict', e.g. deceased still on a pension list). See schema.prisma.
CREATE TABLE "program_gap_rule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'missing',
    "target_module_id" UUID NOT NULL,
    "source_module_ids" UUID[] NOT NULL DEFAULT '{}',
    "min_age" INTEGER,
    "max_age" INTEGER,
    "sex" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "program_gap_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "program_gap_rule_target_module_id_fkey" FOREIGN KEY ("target_module_id") REFERENCES "office_module"("id"),
    CONSTRAINT "program_gap_rule_kind_check" CHECK ("kind" IN ('missing', 'conflict')),
    CONSTRAINT "program_gap_rule_age_check" CHECK ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age")
);

-- Admin only for now: the rules read across every office's records, which
-- office_staff cannot (app-layer office isolation, 20260827120100).
GRANT SELECT, INSERT, UPDATE ON "program_gap_rule" TO admin;

-- Starting rules. Each insert is a no-op when its programs don't exist
-- (fresh databases, test runs), since the module ids come from a SELECT.
INSERT INTO "program_gap_rule" ("name", "description", "kind", "target_module_id", "source_module_ids", "min_age")
SELECT 'Seniors not on the Senior Citizen list',
       'Citizens aged 60 or older (Expanded Senior Citizens Act) who are not registered with CSWD as senior citizens.',
       'missing', t.id, '{}', 60
FROM office_module t WHERE t.slug = 'senior_citizen';

INSERT INTO "program_gap_rule" ("name", "description", "kind", "target_module_id", "source_module_ids")
SELECT 'Babies with a birth record but no immunization',
       'Children with a Civil Registry birth record and no City Health immunization record.',
       'missing', t.id, ARRAY[s.id]
FROM office_module t, office_module s WHERE t.slug = 'immunization' AND s.slug = 'birth';

INSERT INTO "program_gap_rule" ("name", "description", "kind", "target_module_id", "source_module_ids", "max_age")
SELECT 'Children under 2 with no immunization record',
       'Citizens younger than 2 years with no City Health immunization record.',
       'missing', t.id, '{}', 1
FROM office_module t WHERE t.slug = 'immunization';

INSERT INTO "program_gap_rule" ("name", "description", "kind", "target_module_id", "source_module_ids")
SELECT 'Job seekers not yet placed',
       'Registered PESO job seekers with no job placement record.',
       'missing', t.id, ARRAY[s.id]
FROM office_module t, office_module s WHERE t.slug = 'placements' AND s.slug = 'jobseekers';

INSERT INTO "program_gap_rule" ("name", "description", "kind", "target_module_id", "source_module_ids", "min_age", "max_age")
SELECT 'City scholars aged 15 to 30 not in SPES',
       'City scholars in the SPES age range (15 to 30) who are not in the PESO Special Program for Employment of Students.',
       'missing', t.id, ARRAY[s.id], 15, 30
FROM office_module t, office_module s WHERE t.slug = 'spes' AND s.slug = 'scholars';

INSERT INTO "program_gap_rule" ("name", "description", "kind", "target_module_id", "source_module_ids")
SELECT 'Deceased still on the ' || t.name || ' list',
       'People with a Civil Registry death record who are still on this CSWD list. Check before the next payout.',
       'conflict', t.id, ARRAY[s.id]
FROM office_module t, office_module s
WHERE t.slug IN ('senior_citizen', 'pwd', 'solo_parent') AND s.slug = 'death';
