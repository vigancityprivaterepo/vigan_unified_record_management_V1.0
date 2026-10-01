-- Admin-editable short label (acronym) shown in the sidebar, cards and
-- breadcrumbs, e.g. CENRO, CSWDO, BPLO. NULL = derived from the name.
-- Covered by the existing table-level grants on "office".
ALTER TABLE "office" ADD COLUMN "short_name" TEXT;
