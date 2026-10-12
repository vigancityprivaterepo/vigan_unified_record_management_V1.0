-- Outreach on Program gaps: for a "not yet served" rule, whether each person
-- on the list has been contacted and what came of it. One row per rule and
-- person (the latest result); every change is also in the audit log. A
-- person who then registers simply leaves the list, since the list is
-- computed live. See services/programGaps.ts.
CREATE TABLE "outreach_contact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rule_id" UUID NOT NULL,
    "person_key" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "contacted_on" DATE NOT NULL DEFAULT CURRENT_DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "outreach_contact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outreach_contact_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "program_gap_rule"("id") ON DELETE CASCADE,
    CONSTRAINT "outreach_contact_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key") ON DELETE CASCADE,
    CONSTRAINT "outreach_contact_status_check" CHECK ("status" IN ('reached', 'declined', 'not_found', 'moved'))
);
CREATE UNIQUE INDEX "outreach_contact_rule_id_person_key_key" ON "outreach_contact" ("rule_id", "person_key");
CREATE INDEX "outreach_contact_person_key_idx" ON "outreach_contact" ("person_key");

-- Offices record outreach for the rules that target their own programs
-- (routes/officeLists.ts checks the office). DELETE clears a result that
-- was marked on the wrong person.
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_contact" TO admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_contact" TO office_staff;
