-- admin never had DELETE on office/office_module/office_form_field --
-- their original grant migrations only ever gave SELECT/INSERT/UPDATE, so
-- every delete route added since (module delete, field delete, and now
-- office delete) has been one click away from a permission-denied crash
-- (caught the hard way: it's an unhandled Prisma error, so it took the
-- whole backend process down, not just the one request -- see app.ts's
-- process-level safety net added alongside this fix).
GRANT DELETE ON "office", "office_module", "office_form_field" TO admin;

-- staff_account's original grant migration (20260827090000) deliberately
-- withheld DELETE -- "accounts are deactivated, never deleted" was the
-- decision at the time. Reversed here: admin needs to clean up accounts
-- created by mistake (e.g. duplicate accounts from a duplicated office),
-- not just deactivate them. Deactivate is still the right tool for a real
-- former employee's account -- it stays reversible and keeps the account
-- visible in the list with its history; this is for outright mistakes.
GRANT DELETE ON "staff_account" TO admin;
