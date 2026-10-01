-- A widget can now chart more than one module at once (e.g. "seniors vs.
-- PWDs vs. farmers, by barangay" -- one series per module on a shared
-- group-by axis) instead of exactly one. sourceModuleId's single-FK column
-- becomes a join table so each widget can reference any number of modules,
-- same admin-only grant pattern as dashboard_widget itself.
CREATE TABLE "dashboard_widget_source" (
    "widget_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,

    CONSTRAINT "dashboard_widget_source_pkey" PRIMARY KEY ("widget_id", "module_id"),
    CONSTRAINT "dashboard_widget_source_widget_id_fkey" FOREIGN KEY ("widget_id") REFERENCES "dashboard_widget"("id") ON DELETE CASCADE,
    CONSTRAINT "dashboard_widget_source_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "office_module"("id")
);

INSERT INTO "dashboard_widget_source" (widget_id, module_id)
SELECT id, source_module_id FROM "dashboard_widget";

ALTER TABLE "dashboard_widget" DROP CONSTRAINT "dashboard_widget_source_module_id_fkey";
ALTER TABLE "dashboard_widget" DROP COLUMN "source_module_id";

GRANT SELECT, INSERT, UPDATE, DELETE ON "dashboard_widget_source" TO admin;
