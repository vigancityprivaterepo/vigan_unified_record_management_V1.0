-- Same bug as 20260827023514_fix_citizen_insert_column_grants, just missed
-- when business_permits_staff's grants were written by copying the
-- *original* Phase 3 column list instead of the post-fix one: Prisma
-- Client sends explicit values for every client-computable default
-- (now() for @default(now()), false for @default(false)) on every
-- Citizen INSERT, including created_at and is_archived -- caught for real
-- by actually running the test suite against a fresh database, the exact
-- same way the original bug was caught in Phase 4.
GRANT INSERT (created_at, is_archived) ON "Citizen" TO business_permits_staff;
