-- Office staff build their own charts ("story-tell" their office's data).
-- office_id NULL = city-wide chart made by admin; set = owned by that office.
ALTER TABLE "dashboard_widget" ADD COLUMN "office_id" UUID REFERENCES "office"("id");
CREATE INDEX "dashboard_widget_office_id_idx" ON "dashboard_widget" ("office_id");

-- Same app-layer isolation as office_record (see 20260827120100_grant_office_staff):
-- routes/officeWidgets.ts only lets a session touch widgets of its own office,
-- and only with source modules from that office.
GRANT SELECT, INSERT, UPDATE, DELETE ON "dashboard_widget", "dashboard_widget_source" TO office_staff;
