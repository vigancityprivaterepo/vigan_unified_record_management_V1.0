-- 20260827140000 let admin add custom fields to the six original offices'
-- forms (OfficeFormField.formKind), but only office_staff and admin ever
-- got a grant on office_form_field (from the earlier dynamic-offices
-- migration, 20260827120100) -- cswd_staff/agri_staff/civil_registry_staff
-- need SELECT too, since their own intake routes now read that table to
-- validate/render each form's custom fields. Read-only: these three roles
-- never create/edit/delete fields, only admin does (adminStaticOfficeFields.ts).
GRANT SELECT ON "office_form_field" TO cswd_staff, agri_staff, civil_registry_staff;
