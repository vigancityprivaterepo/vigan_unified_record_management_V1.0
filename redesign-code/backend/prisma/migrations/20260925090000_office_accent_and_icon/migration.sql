-- Per-office workspace identity: a hue (0-359, fed into oklch() on the
-- frontend) and an icon key from frontend/src/lib/officeTheme.ts.
-- Table-level grants from 20260827120100_grant_office_staff already cover
-- new columns (office_staff: SELECT, admin: SELECT/INSERT/UPDATE), so no
-- extra GRANT is needed.
ALTER TABLE "office" ADD COLUMN "accent_hue" INTEGER NOT NULL DEFAULT 255;
ALTER TABLE "office" ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'building';
ALTER TABLE "office" ADD CONSTRAINT "office_accent_hue_range" CHECK ("accent_hue" >= 0 AND "accent_hue" < 360);

UPDATE "office" SET "accent_hue" = 145, "icon" = 'sprout'    WHERE "slug" = 'agriculture';
UPDATE "office" SET "accent_hue" = 350, "icon" = 'heart'     WHERE "slug" = 'cswd';
UPDATE "office" SET "accent_hue" = 255, "icon" = 'scroll'    WHERE "slug" = 'civil_registry';
UPDATE "office" SET "accent_hue" = 65,  "icon" = 'clipboard' WHERE "slug" IN ('citizens_charter', 'charter');
