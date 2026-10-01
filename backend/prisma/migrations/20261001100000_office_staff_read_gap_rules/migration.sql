-- Offices see the program-gap rules that target their own programs
-- (routes/officeLists.ts filters by office; read-only, admin still edits).
GRANT SELECT ON "program_gap_rule" TO office_staff;
