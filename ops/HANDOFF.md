# Handoff

This is the single starting point for whoever maintains this system after
the initial build. It doesn't repeat what's documented in more detail
elsewhere — it points there and gives the day-to-day commands.

## Role management

There is no admin UI for staff accounts (deliberately — see the comment at
the top of [`backend/scripts/manageStaffAccount.ts`](../backend/scripts/manageStaffAccount.ts):
the running app only ever has SELECT on `staff_account`, so account
management is a superuser-connection operation done from the server, not
something exposed to the web app under any role including admin).

From the server, with `DATABASE_URL` set to the superuser connection (see
[docker/secrets/README.md](../docker/secrets/README.md#provisioning-the-rbac-role-passwords)
for how that connection string is built):

```bash
cd backend
DATABASE_URL="postgresql://vigan:<db_password>@localhost:<POSTGRES_PORT>/vigan_ucrms" \
  npm run db:manage-staff -- list
  npm run db:manage-staff -- create <username> "<full name>" <role>
  npm run db:manage-staff -- deactivate <username>
  npm run db:manage-staff -- reactivate <username>
  npm run db:manage-staff -- reset-password <username>
```

Roles: `cswd_staff`, `agri_staff`, `civil_registry_staff`, `admin`.
`create` and `reset-password` print a one-time password to stdout — hand it
to the staff member directly, out of band; it's never stored in plaintext,
only its bcrypt hash. `deactivate` blocks future logins immediately but
does **not** kill an already-open session (sessions expire on their own via
`SESSION_IDLE_TIMEOUT_MINUTES`, default 30) — there's no server-side
"kill this session now" mechanism in this build.

Tested for real while building this: created an account, logged in with it
through the actual HTTP API, deactivated/reactivated/reset its password,
and confirmed the invalid-role and no-such-user error paths.

## Backup & restore

Full runbook, tested end to end (not just the backup side): [ops/README.md](README.md).
Short version: `backup` and `minio-backup` Compose services run on a
schedule (daily by default) to `backups/postgres/` and `backups/minio/` on
the host. Restoring means recreating the schema from Prisma migrations
first, then replaying the data-only dump — the runbook has the exact
commands and the two non-obvious gotchas that only showed up when a real
restore was attempted.

## Key rotation

`encryption_key.txt` protects `person_sss`/`gsis`/`philhealth` at rest.
Full step-by-step rotation procedure, including why the order matters and
what "dry-run" actually checks: [docker/secrets/README.md](../docker/secrets/README.md#key-rotation-encryption_keytxt).
This was executed for real (dry-run + real rotation) against seeded test
data while building this system, not just written.

## Threshold tuning

The fuzzy-match threshold that decides "same person" vs. "possible
duplicate, send to the review queue" lives in the `app_setting` table, not
in code — no deploy needed to change it. There's no admin UI for this
either (same reasoning as role management: not wired to a route), but the
`admin` DB role has UPDATE on this table directly:

```bash
PGPASSWORD=<admin_db_password> psql -h localhost -p <POSTGRES_PORT> -U admin -d vigan_ucrms \
  -c "UPDATE app_setting SET value = '0.65', updated_at = now() WHERE key = 'FUZZY_MATCH_THRESHOLD';"
```

Two keys exist: `FUZZY_MATCH_THRESHOLD` (0–1, pg_trgm similarity cutoff —
higher means stricter, fewer auto-matches, more items land in the review
queue) and `FUZZY_MATCH_BDATE_TOLERANCE_DAYS` (how many days of birthdate
difference still counts as a possible match). Reads happen per-request with
no caching (`backend/src/services/config.ts`), so a change here takes
effect on the very next intake request — no restart needed. Tested for
real: read the current value as the `admin` role, updated it, confirmed the
new value round-tripped, reverted it.

## Onboarding a new office

This is real development work, not a configuration change — be upfront
about that rather than implying otherwise. Adding e.g. a "Business Permits"
office means touching, at minimum:

1. **A new Postgres LOGIN role + RLS policy + grants** — a new migration
   modeled on `backend/prisma/migrations/20260827015917_add_rbac_roles_and_rls/`
   (the migration that created the existing five roles).
2. **A satellite table** in `backend/prisma/schema.prisma`, modeled on an
   existing one (`Persons_Farmer` is the simplest single-table example;
   `Person_Birth`/`Person_Death` show the pattern for a table with its own
   extra fields and, for Birth, a document upload).
3. **A route file** under `backend/src/routes/`, modeled on `agri.ts` (uses
   the shared `standardIntakeHandler.ts`, so a new office needs only its
   table name and its own extra `zod` fields — see how `agri.ts` and
   `cswd.ts` both use it).
4. **A frontend intake page** under `frontend/src/pages/`, modeled on
   `AgriFarmerIntakePage.tsx`, reusing `PersonCoreFields`/`IntakeResultCard`.
5. **RBAC test coverage** — add the new role/table to the cross-product in
   `backend/src/db/rbacMatrix.test.ts` and `backend/src/routes/rbacMatrix.test.ts`,
   the tests that catch a route or table silently missing its guard.
6. **The Citizen 360 admin view** (`backend/src/routes/adminDashboard.ts`) —
   add the new satellite table to its aggregation query so a citizen's
   record from the new office shows up there too.
7. **Provision the new role's password** — add it to
   `backend/scripts/provisionDbRoles.ts`'s `ROLES` array and to
   `docker/secrets/` (a new `<office>_db_password.txt`), and to both
   `docker-compose.yml` and `docker-compose.offline.yml`'s `secrets:` /
   backend `environment:` blocks.

None of this has been built or tested here — it's a checklist of exactly
what the existing five-office pattern requires, written so a future
developer isn't starting from a blank page.
