-- Job title / position of a staff account (e.g. "Social Welfare Aide"),
-- shown on the user card and staff list. Free text; NULL = none given.
-- Covered by the existing table-level grants on staff_account.
ALTER TABLE "staff_account" ADD COLUMN "position" TEXT;
