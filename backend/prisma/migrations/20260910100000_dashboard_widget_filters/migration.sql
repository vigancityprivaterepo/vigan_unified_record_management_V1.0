-- Optional value filters that narrow a widget's query without being shown
-- as a chart axis (e.g. "Farmers in just Barangay X", vs. group-by which
-- always breaks out every value). No new grant needed -- dashboard_widget's
-- existing grant (20260827130000_add_dashboard_widgets) is table-wide with
-- no column list, so it already covers these.
ALTER TABLE "dashboard_widget" ADD COLUMN "filter_barangay_code" VARCHAR(10);
ALTER TABLE "dashboard_widget" ADD COLUMN "filter_sex" TEXT;
ALTER TABLE "dashboard_widget" ADD COLUMN "filter_month" TEXT;
