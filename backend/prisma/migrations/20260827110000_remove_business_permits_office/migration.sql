-- Reversal, not a delete-the-history-and-pretend-it-never-happened: Business
-- Permits/Licensing is removed per explicit product decision -- it has its
-- own 3rd-party system of record that already generates the authoritative
-- business count/list, and recording it again here would create a second,
-- conflicting source of truth for the same data. The same reasoning rules
-- out Treasury (real property tax) and Assessor from this system's office
-- list going forward -- both also have their own systems of record.

-- 1. Any staff account on the role being dropped must go first, or the
-- enum column-type change in step 4 fails on that row.
DELETE FROM staff_account WHERE role = 'business_permits_staff';

-- 2. Drop the office table -- this also drops its RLS policies and any
-- grants on it, since both live on the table itself.
DROP TABLE IF EXISTS "Business_Permit";

-- 3. Revoke every remaining grant the role holds (Citizen's column-scoped
-- grants, barangay, app_setting, audit_log, duplicate_review_queue_item,
-- schema USAGE, database CONNECT), then drop the role. Postgres refuses to
-- drop a role that still holds privileges anywhere.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM business_permits_staff;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM business_permits_staff;
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM business_permits_staff', current_database());
END $$;
DROP ROLE IF EXISTS business_permits_staff;

-- 4. Postgres has no `ALTER TYPE ... DROP VALUE` -- removing an enum value
-- means creating a replacement type without it, migrating the one column
-- that uses it, then swapping the old type out for the new one under the
-- original name.
CREATE TYPE "StaffRole_new" AS ENUM ('cswd_staff', 'agri_staff', 'civil_registry_staff', 'admin');
ALTER TABLE staff_account ALTER COLUMN role TYPE "StaffRole_new" USING (role::text::"StaffRole_new");
DROP TYPE "StaffRole";
ALTER TYPE "StaffRole_new" RENAME TO "StaffRole";
