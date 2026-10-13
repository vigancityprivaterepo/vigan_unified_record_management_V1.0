-- A third kind of account: 'viewer', for the mayor and other city officials.
-- View only, and only counts and charts: never a list of people. It has no
-- Postgres role of its own; what it may read is a fixed list of GET routes
-- in src/middleware/auth.ts.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'viewer';
