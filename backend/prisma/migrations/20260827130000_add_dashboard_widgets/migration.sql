-- Admin-saved custom dashboard visualizations. Purely admin-authored
-- configuration (no office role ever reads or writes this table), so this
-- migration only needs to grant admin -- no RLS, no other role's grants.
CREATE TABLE "dashboard_widget" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_office_id" UUID,
    "group_by" TEXT,
    "chart_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by" UUID,

    CONSTRAINT "dashboard_widget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dashboard_widget_source_office_id_fkey" FOREIGN KEY ("source_office_id") REFERENCES "office"("id")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "dashboard_widget" TO admin;
