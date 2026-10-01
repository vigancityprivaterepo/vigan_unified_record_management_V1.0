-- Optional "only records where <form field> = <value>" widget filter,
-- e.g. Assessor's EGAPS owners limited to Current Revision = Yes.
ALTER TABLE "dashboard_widget" ADD COLUMN "filter_field_key" TEXT;
ALTER TABLE "dashboard_widget" ADD COLUMN "filter_field_value" TEXT;
