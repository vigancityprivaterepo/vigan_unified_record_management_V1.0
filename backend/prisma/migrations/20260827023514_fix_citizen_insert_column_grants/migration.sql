-- Bug found in Phase 4 (integration testing an office insert through
-- Prisma, not raw SQL): Prisma Client sends explicit values for every
-- client-computable default (now() for a plain @default(now()), false for
-- @default(false)), not just fields the caller actually sets. The Phase 3
-- Citizen INSERT column grant was missing created_at and is_archived --
-- both defaulted, neither ever set by app code, but Prisma includes them
-- in the INSERT statement regardless, so their absence from the grant
-- list made every Citizen creation as a non-admin role fail outright.
GRANT INSERT (created_at, is_archived) ON "Citizen" TO cswd_staff, agri_staff, civil_registry_staff;
