-- What each widget bar/slice measures: 'count' (records, as before) or
-- 'sum:<fieldKey>' (total of a NUMBER form field, e.g. assessed value).
ALTER TABLE "dashboard_widget" ADD COLUMN "measure" TEXT NOT NULL DEFAULT 'count';
