-- group_by becomes an array (0-2 dimensions, enforced app-side) so a
-- widget can group by, say, barangay AND sex at once -- the composite
-- label is built app-side from however many dimensions are stored here.
ALTER TABLE "dashboard_widget" ADD COLUMN "group_by_arr" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "dashboard_widget"
SET group_by_arr = CASE WHEN group_by IS NULL THEN '{}'::text[] ELSE ARRAY[group_by] END;

ALTER TABLE "dashboard_widget" DROP COLUMN "group_by";
ALTER TABLE "dashboard_widget" RENAME COLUMN "group_by_arr" TO "group_by";
