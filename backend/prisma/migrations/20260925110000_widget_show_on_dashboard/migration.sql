-- Visualizations can be saved without appearing on the admin Dashboard.
-- Existing widgets were all shown, so they default to true. Covered by the
-- existing table-level admin grant on dashboard_widget.
ALTER TABLE "dashboard_widget" ADD COLUMN "show_on_dashboard" BOOLEAN NOT NULL DEFAULT true;
