# Vigan Unified Citizen Records System

Internal, air-gapped citizen-records system for the LGU of Vigan. See
`buildPrompt.txt` for the full phased spec.

## Status: Phase 10 — deployment finalization (complete)

- `backend/` — Node.js + Express + TypeScript (strict), hello-world `GET /health`
- `frontend/` — React + Vite + TypeScript + Tailwind, calls backend `/health`
- `docker-compose.yml` — Postgres 15.8, MinIO, backend, frontend
- Secrets via Docker secrets files under `docker/secrets/` (gitignored), not env vars
- `backend/prisma/schema.prisma` — Citizen, Barangay, all satellite tables (Persons_Senior/PWD/Solo_Parent/Farmer, Person_Birth/Death), audit_log, app_setting
- `backend/prisma/seed.ts` — fake PH dev data: 7 households (incl. nested sub-households), 10 barangays, satellite records, one unresolved birth record
- `backend/src/services/resolvePerson.ts` — exact match → fuzzy match (pg_trgm, config-driven threshold) → race-safe create, the one entry point every office's intake flow calls
- `backend/src/services/mergeCitizens.ts` — reassigns every satellite FK + household reference from a losing `person_key` to a winning one, archives the loser, logs the merge
- `backend/src/services/config.ts` — runtime-adjustable settings (`app_setting` table), no code deploy needed to change the fuzzy-match threshold
- `backend/prisma/migrations/..._add_rbac_roles_and_rls/` — 5 real Postgres LOGIN roles (`cswd_staff`, `agri_staff`, `civil_registry_staff`, `admin`, `app_service`), table + column grants, and RLS policies on every satellite table — enforced in Postgres itself, testable with a raw SQL client, no app layer involved
- `backend/scripts/provisionDbRoles.ts` — sets the real RBAC role passwords (from Docker secrets) after migration, overwriting the migration's placeholder
- `backend/src/lib/session.ts`, `backend/src/routes/auth.ts` — session-based auth (Postgres-backed via connect-pg-simple), rolling idle timeout, login/logout audit-logged
- `backend/src/lib/auditLog.ts` — raw-SQL audit insert helper; Prisma's typed `.create()` always does `INSERT ... RETURNING`, which needs SELECT privilege Postgres requires for any RETURNING column — incompatible with audit_log's intentionally insert-only grant for non-admin roles
- `backend/src/lib/prismaByRole.ts` — one PrismaClient per RBAC role, lazily created; office routes use the client matching the session's role instead of the migration-owner superuser
- `backend/src/routes/cswd.ts` — `POST /cswd/seniors`: the first real office intake endpoint, wired to `resolvePerson()` under the caller's own RBAC-scoped connection
- `backend/prisma/schema.prisma` (`DuplicateReviewQueueItem`) — where a `needs_review` intake goes instead of being silently dropped; Phase 5 builds the admin review/approve UI on top of this
- `frontend/src/pages/` — actual login + CSWD Senior intake UI (shadcn/ui primitives added: Button, Input, Label, Card, Select, Checkbox), demoable end-to-end in a browser
- `backend/src/routes/adminReview.ts` — approve/reject a queued intake: materializes it as a normal Citizen + satellite record, then (approve) merges it into the admin-chosen candidate via `mergeCitizens()`, or (reject) leaves it standing as a new, distinct citizen
- `backend/src/services/officeSatelliteWriters.ts` — office-table dispatch for "create the satellite record for this person_key", shared by the CSWD intake route and the review-queue approve/reject routes
- `frontend/src/pages/DuplicateReviewQueuePage.tsx` — admin-only queue UI: queued intake vs. fuzzy-match candidates side by side, merge or reject per candidate
- `backend/src/services/standardIntakeHandler.ts` — the resolve→queue-or-create→satellite→audit sequence, shared by 5 of 6 office endpoints (Senior/PWD/Solo Parent/Farmer/Death); each just supplies its office table name and its own extra zod fields
- `backend/src/routes/agri.ts` — `POST /agri/farmers` + `GET /agri/farmers/export.csv` (RSBSA-style masterlist, explicit column `select` to avoid pulling Citizen's encrypted columns)
- `backend/src/routes/civilreg.ts` — `POST /civilreg/deaths` (standard handler) and `POST /civilreg/births` (its own handler: Person_Birth is the only satellite table with a nullable `person_key`, gated on `birthIsFromVigan`, plus a document upload)
- `backend/src/lib/minio.ts`, `documentUpload.ts`, `sanitizeFilename.ts` — MinIO client, multer upload with MIME-type allowlist + 10MB limit, and object-key generation that never trusts the original filename
- `frontend/src/pages/` — PWD, Solo Parent (CSWD tabs), Farmer + CSV export (Agriculture), Birth (with file input) + Death (Civil Registry tabs); `PersonCoreFields`/`IntakeResultCard` extracted once 5 forms needed the same core-fields block and result display
- `backend/src/routes/adminDashboard.ts` — Citizen search + 360 view (aggregates every office's records for one `person_key`), household grouping (`person_parent_key`/`person_sub_parent_key`), cross-office per-barangay counts (raw SQL, joins Citizen's barangay column across 3 satellite tables), and a citizen masterlist CSV export
- `frontend/src/pages/CitizensPage.tsx`, `HouseholdsPage.tsx`, `AdminDashboardPage.tsx` — the admin-only views for the above, all reachable from new tabs
- `backend/src/lib/encryption.ts` — AES-256-GCM at rest for `person_sss/gsis/philhealth`, actually implemented (schema-only since Phase 1); `PATCH /admin/citizens/:personKey/government-ids` encrypts on write, the Citizen 360 view decrypts server-side for admin only
- `backend/scripts/rotateEncryptionKey.ts` — dry-run-capable key rotation, decrypts every row with the old key and re-encrypts with the new one; full runbook in [docker/secrets/README.md](docker/secrets/README.md)
- `backend/src/db/rbacMatrix.test.ts`, `backend/src/routes/rbacMatrix.test.ts` — the Phase 8 re-audit as an actual test suite: full cross-product of every office role × every satellite table (raw SQL) and every endpoint × every role (HTTP), not spot checks
- `ops/pg_backup_loop.sh`, `ops/minio_backup_loop.sh` — scheduled `backup`/`minio-backup` Compose services, data-only `pg_dump` + gzip and `tar` of the MinIO data volume, both to bind-mounted host directories with retention pruning
- `ops/README.md` — the restore runbook for both, tested for real against a throwaway target, not just written
- `docker-compose.offline.yml` — the compose file actually run on the target LGU server: `backend`/`frontend` reference pre-built tagged images instead of a `build:` context, and every service sets `pull_policy: never` so a missing image fails loudly instead of silently reaching for a registry
- `ops/build_offline_bundle.sh` (run with internet, on a build machine) / `ops/install_offline.sh` (run on the air-gapped target, no internet used) — assemble and install a self-contained `offline-bundle/` of `docker save`d images + compose file + docs; migrations and RBAC provisioning run *inside* the already-loaded backend image (it ships `prisma`/`tsx` in `node_modules`), so the target machine needs no host Node.js at all
- `backend/scripts/manageStaffAccount.ts` — create/deactivate/reactivate/reset-password for staff logins; a superuser-connection script, not an HTTP route, matching `staff_account`'s intentionally read-only grant to the app's own DB role
- `ops/HANDOFF.md` — the maintainer's starting point: role management, backup/restore, key rotation, threshold tuning, and an honest checklist (not a false promise of a config toggle) for onboarding a new office

## Run locally

1. Copy `.env.example` to `.env` and adjust ports if needed. **If you already run Postgres locally, port 5432 will collide** — set `POSTGRES_PORT` to something else (e.g. `5433`).
2. Generate secret files — see [docker/secrets/README.md](docker/secrets/README.md).
3. `docker compose up --build`
4. Frontend: http://localhost:5173 — backend: http://localhost:4000/health
5. Sign in at http://localhost:5173 as `cswd.demo` / `dev-password-not-for-prod` (see [demo staff accounts](#database-migrate--seed)) and register a senior citizen — the first end-to-end office flow (Phase 4)
6. Register the same person again with a slightly misspelled name to trigger a fuzzy match, then sign in as `admin.demo` and open the Duplicate Review Queue tab to approve (merge) or reject it (Phase 5)
7. Sign in as `agri.demo` / `civilreg.demo` for the other offices' intake forms (Phase 6) — Civil Registry's Birth form uploads a document to MinIO; the Agriculture header has an "Export RSBSA CSV" button
8. As `admin.demo`, the default tab is now the cross-office Dashboard — also try Citizens (search "Domingo", open the 360 view) and Households (Phase 7)
9. On a Citizen 360 view, use "Edit" under Government IDs to set an SSS/GSIS/PhilHealth number — it's encrypted before it ever reaches Postgres; "Reveal" decrypts it back for display (Phase 8)

## Database: migrate + seed

Prisma CLI runs from the host against the Postgres port published by Docker Compose.
Build `DATABASE_URL` from `docker/secrets/db_password.txt` (URL-encode the password — it's
base64 and may contain `+`, `/`, `=`), matching whatever `POSTGRES_PORT` you set in `.env`:

```bash
export DATABASE_URL="postgresql://vigan:<url-encoded-password>@localhost:5433/vigan_ucrms?schema=public"
cd backend
npx prisma migrate deploy   # apply migrations to an empty DB
npm run db:provision-roles  # set the real RBAC role passwords (see docker/secrets/README.md)
npx prisma db seed          # load fake PH dev data + demo staff accounts
```

Extensions (`pg_trgm`, `pgcrypto`) are enabled by the migration itself — no manual `psql` step.

Demo login (dev/test only, all four roles use the same password):

```bash
curl -X POST http://localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"cswd.demo","password":"dev-password-not-for-prod"}'
```

Other demo usernames: `agri.demo`, `civilreg.demo`, `admin.demo`.

### Connection to the AICS system

CSWD's AICS system keeps its own cases. This system pulls the assistance AICS has
released (read-only) so the Assistance page counts it and nobody encodes a case twice.
The contract is [integrations/aics/openapi.yaml](integrations/aics/openapi.yaml); AICS serves it,
with Swagger UI, at `/api/integration/v1/docs`.

1. In AICS, create a key: `node scripts/createIntegrationKey.mjs vucrms`, put the printed
   `INTEGRATION_API_KEYS=...` line in its environment file and restart its backend.
2. Here, set `AICS_BRIDGE_URL` (for example `http://aics-server:5101/api/integration/v1`) and
   `AICS_BRIDGE_KEY` (the key printed in step 1), then restart the backend.
3. As administrator, open Assistance: "Connected to AICS" shows what the last pull brought. The server pulls on its own every `AICS_BRIDGE_INTERVAL_MINUTES` (15 by default).

A program with the code `aics` must exist (under CSWD) and be ticked "Counts as assistance".
Each release becomes one record there, matched to the citizen by name and birthdate; a name
that is only close goes to Duplicate review, and an AICS client with no date of birth is skipped.

### City demo data (for presentations)

[backend/scripts/seedCityDemo.ts](backend/scripts/seedCityDemo.ts) adds a sample city on top of whatever is
already in the database: about 3,000 sample citizens in households across all 39 barangays, sample
records for every office's programs, four more offices (POSO, Economic Enterprise, Public Assistance,
Youth Development), new programs for existing offices, charts and program gap rules. Every record is
tagged as sample data, and the script never edits or deletes rows it did not add (one exception: it switches on "Counts as assistance" for the programs that give help to people, so the Assistance page has data).

```bash
cd backend
npm run db:city-demo              # add it (does nothing if it is already there)
npm run db:city-demo -- --reset   # rebuild it
npm run db:city-demo -- --remove  # take all of it out again
npm run db:city-demo -- --assistance  # only mark the assistance programs (for the Assistance page)
```

## Dev without Docker

```bash
npm install --workspaces
# backend needs DB_PASSWORD / SESSION_SECRET / ENCRYPTION_KEY env vars set locally,
# plus DATABASE_HOST/PORT/NAME and the five *_DB_PASSWORD role vars for RBAC --
# see backend/.env.example
npm run --workspace backend dev
npm run --workspace frontend dev
```

## Lint / typecheck

```bash
npm run lint
npm run typecheck
```

Runs in CI on every push/PR — see `.github/workflows/ci.yml`.

## Phase 0 exit checklist

- [x] `docker compose up` brings up empty Postgres + MinIO + hello-world API + hello-world frontend
- [x] Secrets read from Docker secrets / `.env`, never hardcoded; `.env.example` committed
- [x] Lint + typecheck run in CI

## Phase 1 exit checklist

- [x] `prisma migrate deploy` runs clean on an empty DB
- [x] Seed script populates enough fake citizens/households to exercise fuzzy matching and household grouping (verified: `similarity()` correctly ranks exact/near/unrelated names; household `person_parent_key`/`person_sub_parent_key` grouping queries return correct counts, incl. nested grandchild households)
- [x] `pg_trgm` and `pgcrypto` extensions enabled via migration, not a manual `psql` step

## Phase 2 exit checklist

- [x] Unit tests: exact match, fuzzy match above/below threshold, no match, and the merge-reassigns-all-FKs case ([resolvePerson.test.ts](backend/src/services/resolvePerson.test.ts), [mergeCitizens.test.ts](backend/src/services/mergeCitizens.test.ts))
- [x] Integration test simulating concurrent resolve calls for the same new person proves only one Citizen row is created ([resolvePerson.concurrency.test.ts](backend/src/services/resolvePerson.concurrency.test.ts))
- [x] Threshold is read from config (`app_setting` table), changeable without a code deploy ([config.test.ts](backend/src/services/config.test.ts))

Run tests: see [Database: migrate + seed](#database-migrate--seed) to set `DATABASE_URL`, then `npm run test --workspace backend`. CI runs the same against a fresh Postgres service container.

## Phase 3 exit checklist

- [x] A `cswd_staff` DB session cannot SELECT or UPDATE Agriculture's satellite tables, even via a raw SQL client — verified both manually with `psql` and in [rbac.test.ts](backend/src/db/rbac.test.ts), which connects directly with `pg` (no Prisma, no app layer)
- [x] Session idle-timeout enforced and tested — rolling Postgres-backed session, tested for real expiry and for reset-on-activity in [auth.test.ts](backend/src/routes/auth.test.ts)
- [x] Audit log UPDATE/DELETE blocked at the DB grant level for every role, including admin (`rbac.test.ts`)

Bugs found and fixed while building this phase:
- Postgres requires SELECT privilege on any column named in a `RETURNING` clause, and Prisma's `.create()` always uses one — silently incompatible with audit_log's intentional insert-only grant for non-admin roles. Fixed with a raw-SQL insert helper ([auditLog.ts](backend/src/lib/auditLog.ts)) that never asks for rows back.
- `resolvePerson()`'s advisory lock only wrapped the *create* step (Phase 2) — a genuine race let a concurrent call's unlocked fuzzy-match read see another transaction's just-committed row as a fuzzy hit (misclassified as `needs_review`) instead of an exact one. Fixed by locking the entire exact→fuzzy→create sequence, not just the write.
- `req.session.regenerate()`'s async callback had no try/catch — an error inside it (as above) was an unhandled rejection Express never saw, hanging the request instead of failing it.
- A fresh `pg.Pool` was being opened per `createApp()` call with nothing to close it, leaking connections across tests. Made the session store's pool a per-process singleton.

Run tests the same way as Phase 2, but first apply the Phase 3 migration and provision role passwords — see [Database: migrate + seed](#database-migrate--seed) above. From Phase 6 on, tests also need MinIO running (`docker compose up -d minio`) and `DB_PASSWORD`/`MINIO_ENDPOINT`/`MINIO_PORT`/`MINIO_ACCESS_KEY` set (same values as the Postgres/MinIO secrets — see `backend/.env.example`).

## Phase 4 exit checklist

- [x] A staff user can register a senior citizen, see fuzzy-match candidates when applicable, and the record is correctly linked or queued — verified with real backend integration tests ([cswd.test.ts](backend/src/routes/cswd.test.ts): create/link/queue) **and** end-to-end in a real browser against the live `docker compose` stack (Playwright driving Chromium against `localhost:5173`/`localhost:4000` — login → fill form → submit; screenshots confirmed all three outcomes render: "New citizen registered", "Linked to existing citizen", "Queued for admin review")
- [x] Every write in the flow produces a correct `audit_log` row (`cswd.test.ts` asserts rows for the Citizen insert, the Persons_Senior insert, and the queue insert, each with the correct `actor_role`)
- [x] Demoable end-to-end in the UI, not just via API calls — see screenshots above; the office route runs under the authenticated session's own RBAC-scoped Postgres connection (`getPrismaForRole`), not the migration-owner superuser

Bugs found and fixed while building this phase:
- **`tx.citizen.create()` without a `select` RETURNINGs every column**, including the three encrypted ones office roles have no SELECT grant on — same bug class as Phase 3's audit_log issue, just on Citizen this time. `resolvePerson()`'s create step now narrows to `select: { personKey: true }`.
- **Prisma sends explicit values for every client-computable default** (`now()`, `false`), not just fields the caller sets — Phase 3's Citizen INSERT column grant was missing `created_at` and `is_archived`, so *every* Citizen creation as a non-admin role failed outright. Only caught by actually running a real insert through Prisma as `cswd_staff`, not by reasoning about what "should" be sent.
- **Prisma's `prisma migrate dev` sees any table not declared in `schema.prisma` as drift** and proposes dropping it — the raw-SQL `session` table from Phase 3 would have been dropped by the next migration. Fixed by declaring it as a `@@ignore`d model (tracked for migration diffing, excluded from the generated Client).
- Radix Select renders a visually-hidden native `<select>` for autofill alongside the visible listbox — a Playwright `text=Male` locator silently matched the hidden one instead of the visible option, until scoped to `[role="option"]`.

## Phase 5 exit checklist

- [x] Approving a match correctly reassigns satellite FKs and archives the losing Citizen row — [adminReview.test.ts](backend/src/routes/adminReview.test.ts) asserts the satellite record ends up on the winner and the loser's `is_archived` flips true; verified end-to-end in a real browser too (approve → item disappears from the queue)
- [x] Rejecting a match creates a new, distinct Citizen row and the queue item is cleared — same test file; "cleared" means marked `rejected` and filtered out of the pending list, not hard-deleted, so the decision stays in the audit trail
- [x] Every decision is attributed to the reviewing admin in `audit_log` — a `duplicate_review_queue_item` / `update` row with `actor_role: 'admin'` and the decision + winning/new person_key in `changed_fields`, on top of `mergeCitizens()`'s own `merge` audit row

How a queued intake resolves, since it was never created as a Citizen at intake time (`resolvePerson()`'s `needs_review` branch queues raw data, nothing else): approve and reject both first materialize it as an ordinary new Citizen + satellite record (the same path a genuinely-new intake takes) via a shared `materializeQueuedIntake()` helper. Reject stops there. Approve immediately calls `mergeCitizens(winningKey, thatNewKey, adminId)` — the exact same merge path Phase 2 built for "two already-existing citizens turn out to be the same person" — so there's one merge implementation, not two.

Known gap: `materializeQueuedIntake()`'s Citizen+satellite insert is one transaction, and `mergeCitizens()` is its own transaction, but the two aren't composed into one — a crash between them would leave a materialized-but-unmerged Citizen sitting around (recoverable: the queue item is still `pending`, so a retry would materialize a second one rather than silently corrupting anything, but it's not automatically rolled back). Not exercised by the current tests since nothing injects a mid-flow failure.

## Phase 6 exit checklist

- [x] Each office's intake flow is demoable end-to-end — [cswd.test.ts](backend/src/routes/cswd.test.ts) (PWD, Solo Parent), [agri.test.ts](backend/src/routes/agri.test.ts) (Farmer + CSV export), [civilreg.test.ts](backend/src/routes/civilreg.test.ts) (Birth, Death) all pass, **and** every one of the 6 endpoints was driven end-to-end in a real browser against the live `docker compose` stack: logged in as each of the 4 roles, submitted PWD/Solo Parent/Farmer/Birth (with an actual PDF upload)/Death, and downloaded the RSBSA CSV export through the browser's own download mechanism
- [x] Birth/Death soft-delete verified — no DELETE grant exists on `Person_Birth`/`Person_Death` for *any* role including admin (checked directly via raw SQL, not just civil_registry_staff), and no backend route exposes a delete for either table (`civilreg.test.ts`)
- [x] MinIO upload rejects disallowed MIME types and oversized files — verified against a real MinIO container (not mocked): a `.sh` file is rejected before ever reaching MinIO, an 11MB file is rejected by multer's size limit, and a valid PDF is genuinely uploaded and its object key stored

How Birth fits the pattern without forcing it: every other office's satellite table requires a resolved `person_key`, so [standardIntakeHandler.ts](backend/src/services/standardIntakeHandler.ts) covers Senior/PWD/Solo Parent/Farmer/Death with one implementation. `Person_Birth.person_key` is the only nullable one, and whether `resolvePerson()` even runs depends on `birthIsFromVigan` — that's different enough to warrant its own handler in `civilreg.ts`, built from the same `resolvePerson()`/`createSatelliteRecord()`/`insertAuditLog()` pieces rather than bent to fit the shared one.

Bugs found and fixed while building this phase (none from the office-route logic itself this time — all 47 tests passed on the first run; these were found writing the shared pieces before any test ran):
- A stray `#` typo where `//` was intended, twice, in freshly-written comments (`standardIntakeHandler.ts`, `PersonCoreFields.tsx`) — would have been a hard syntax error. Caught by writing the file and re-reading it, not by a test.
- `officeSatelliteWriters.ts`'s Death/Birth date fields assumed `candidateData.deathDdate`/`.bdate` would always be a string, but they're a real `Date` instance when called straight from an intake handler's zod-parsed data (only an ISO string when replayed from the JSON-stored review queue). `new Date(x)` accepts either, so widened the type rather than forcing a stringify somewhere.
- Multer's `fileFilter` rejection was a plain `Error`, which the app-level error handler couldn't distinguish from an unrelated bug elsewhere without mislabeling every uncaught exception as an upload problem. Introduced `UploadValidationError` so the handler only claims errors that are actually about uploads.

## Phase 7 exit checklist

- [x] Citizen 360 correctly aggregates data across all offices for a given `person_key` — [adminDashboard.test.ts](backend/src/routes/adminDashboard.test.ts) plus a real-browser check against the actual seed data: Ramon Domingo (seeded as both a Senior and a Farmer) correctly shows "CSWD -- Senior Citizen: 1 record" and "Agriculture -- Farmer: 1 record", every other office correctly "none"
- [x] Barangay counts match a manual spot-check against seed data — computed by hand from `seed.ts` (Paoa: 2 seniors/0 PWD/2 farmers, Camangaan: 0/1/0, Rugsuanan: 1/0/0, Bulala: 0/0/1, Barangay II: 0/0/1, total 3 seniors/1 PWD/4 farmers) and confirmed pixel-for-pixel against the live dashboard in a real browser, not just asserted in a test the same code could be wrong in the same way
- [x] Export file opens correctly in the target format, field mapping verified, not just CSV shape — downloaded through the browser's own download mechanism and checked row-by-row: 20 rows (matching all 20 seeded citizens exactly), and the Domingo rows correctly distinguish an actual `Persons_Farmer` satellite record (`Is Farmer: Y`) from Elena Domingo's free-text `person_occupation = "Farmer"` with no such record (`Is Farmer: N`) — **however, see the caveat below on what "target format" means here**

**On "DILG DMS4LGUs-compatible"**: the spec asks for this, but this codebase has no verified source for DMS4LGUs's actual current field schema, and fabricating official-looking government column codes to label as "compliant" would be worse than admitting the gap — the same judgment call already made for the placeholder PSGC barangay codes back in Phase 1. What's built is a general, well-structured LGU citizen masterlist CSV with a correct, tested field mapping against *this system's own data model* — flagged in both the route file and the dashboard UI itself as needing validation against DILG's real template before anyone submits it as a DMS4LGUs file. Treat the export mechanism and field-mapping discipline as done; treat the specific DILG compliance claim as open.

Household grouping and the per-barangay dashboard both needed to join a satellite/relation table's rows by a column that only lives on `Citizen` (`person_brgy_code`, `person_parent_key`) -- Prisma's typed `groupBy` can't join across tables for this, so the dashboard query is raw SQL rather than three separate queries merged in application code.

No new backend bugs surfaced this phase either (56/56 tests passed on the first run) -- the one real mistake was procedural, not a code bug: after running the test suite (whose `resetDb()` wipes Citizen/satellite data between tests), I started browser-verifying the dashboard against the *previous* test run's leftover fixture data instead of the reseeded demo data, and got an all-zeros dashboard with garbage barangay names in the list. Reseeding before browser verification -- not after running tests -- is the actual lesson; a real deployment wouldn't have this failure mode since it seeds once, this was purely an artifact of iterating tests and manual verification against the same database.

## Phase 8 exit checklist

- [x] Attempted cross-office access, tested manually per role, fails everywhere it should — re-audited every route's guard directly from the code (not from memory: `grep`'d every `router.get/post/patch` + its middleware across all 8 route files), then proved it with the full cross-product rather than spot checks: [rbacMatrix.test.ts](backend/src/db/rbacMatrix.test.ts) (69 tests — every office role × every satellite table × SELECT/INSERT/UPDATE/DELETE, raw `pg`, no app layer) and [rbacMatrix.test.ts](backend/src/routes/rbacMatrix.test.ts) (55 tests — every office/admin endpoint × every role, HTTP layer, unauthenticated included)
- [x] `person_sss`/`gsis`/`philhealth` confirmed unreadable via direct psql SELECT without the app-layer key — actually implemented encryption at rest for the first time (AES-256-GCM, schema-only placeholder since Phase 1), then proved it two ways: [adminDashboard.test.ts](backend/src/routes/adminDashboard.test.ts) round-trips a value through the real HTTP API and reads the raw bytes back with `pg` (not Prisma) as the migration-owner superuser — the strongest DB read access that exists — confirming they're genuine ciphertext; **and** the identical check by hand in a real browser: set an SSS number via the Citizen 360 "Edit" form, then `SELECT encode(person_sss_enc, 'hex')` directly against the running Postgres container and got opaque bytes with no resemblance to the plaintext
- [x] Key rotation procedure documented and dry-run once — [docker/secrets/README.md](docker/secrets/README.md#key-rotation-encryption_keytxt) has the full runbook; "dry-run once" was taken literally: seeded 3 citizens with real encrypted SSS/GSIS values, ran `rotateEncryptionKey.ts --dry-run` (decrypted all 3 with the old key, wrote nothing), then ran the real rotation, then confirmed the *old* key no longer decrypts the rotated rows and the *new* key recovers the exact original plaintext — proving the script actually re-encrypts rather than just relabeling data

One real gap found by this phase's own CI dry-run (not by reasoning about the code): the GitHub Actions `test` job never had `ENCRYPTION_KEY` set. `encryption.test.ts` doesn't need it (every call passes an explicit key), but `adminDashboard.test.ts`'s government-IDs test exercises the real route handler, which defaults to `env.encryptionKey` — that throws immediately without the secret. Caught by actually simulating the CI job end-to-end against a fresh container (the same discipline used every phase, not new to this one), not by inspection.

What "re-audit" concretely meant here, since it's a vaguer instruction than the other two checklist items: reading every route registration from the actual files rather than trusting memory of what Phase 3-7 built, confirming `adminDashboardRouter.use(requireRole('admin'))` really does apply to all 6 of its sub-routes (router-level middleware, not per-route — easy to misread as unguarded from a `grep` alone), and turning the result into tests that will keep failing if a future phase ever adds a route and forgets the guard, rather than a one-time manual pass whose findings go stale immediately.

Next: Phase 9 — offline resilience & backup/restore (scheduled `pg_dump`, MinIO bucket backup, a documented and *tested* restore runbook, and confirming the stack survives a full reboot with no manual intervention).

## Phase 9 exit checklist

- [x] Backup job runs on a schedule and produces a restorable dump — tested the restore, not just the backup: stood up a genuinely separate throwaway Postgres container, ran `prisma migrate deploy` + `db:provision-roles` against it, truncated the seeded defaults, replayed a real backup file with `psql -v ON_ERROR_STOP=1`, then confirmed row counts and a spot-checked `Citizen` record matched the live source exactly. Did the same for MinIO: untarred a real backup into a fresh volume, pointed a new MinIO container at it, and confirmed all 13 objects listed and a downloaded object matched the source byte-for-byte.
- [x] `docker compose up` after a reboot brings the full stack back with no manual DB fixes — `docker compose down` (no `-v`) then `docker compose up -d`: all health checks passed, `Citizen` row count and the MinIO object list were unchanged, no migration re-run or manual intervention needed.
- [x] MinIO data survives a container recreate — `docker compose up -d --force-recreate minio`: all 13 objects present and unchanged afterward, confirming `miniodata` is a real named volume, not ephemeral container storage.

Two real restore bugs, both found only by actually attempting a restore end to end (not by reasoning about the backup script): (1) `migrate deploy` seeds a couple of default `app_setting` rows via `INSERT ... ON CONFLICT DO NOTHING`, which collided with the backup's own copy of those same rows on replay — fixed by documenting a `TRUNCATE` step before replay; (2) `pg_dump --data-only` has no special awareness of Prisma's own `_prisma_migrations` bookkeeping table and dumped it like any other table, colliding with the restore target's own correct copy from its own `migrate deploy` — fixed by excluding it (and the transient `session` table) from the `pg_dump` invocation itself. Full writeup and the exact restore commands: [ops/README.md](ops/README.md).

## Phase 10 exit checklist

- [x] A clean machine with no internet access can run the full install from a vendored bundle — tested literally, not just built: ran `ops/build_offline_bundle.sh` (builds + tags + `docker save`s all 5 images the stack needs into `offline-bundle/`), then simulated a clean machine by `docker rmi`-ing all 5 of those images from the local Docker daemon, confirmed they were gone, and ran `ops/install_offline.sh` from inside the bundle directory alone. It `docker load`ed every image from the bundle's `.tar.gz` files, brought up `docker-compose.offline.yml` (which sets `pull_policy: never` on every service — a hard guarantee, not just a claim, that a missing image fails loudly instead of silently pulling), ran `prisma migrate deploy` + RBAC role provisioning *inside* the already-loaded backend container (no host Node.js used at any point), created a real staff account with `manageStaffAccount.ts`, and logged in through the actual HTTP API — confirmed a real session cookie came back and `/auth/me` recognized it.
- [x] Handoff doc covers role management, backup/restore, key rotation, threshold tuning, and onboarding a new office — [ops/HANDOFF.md](ops/HANDOFF.md). Role management (`manageStaffAccount.ts`) and threshold tuning (direct `UPDATE` against `app_setting` as the `admin` DB role) were both new — neither had a script or admin-UI route before this phase — and both were tested for real: created/deactivated/reactivated/reset-password on a real account and logged in with it; read, updated, and reverted the fuzzy-match threshold and confirmed the round trip. Backup/restore and key rotation link to their existing, already-tested runbooks rather than duplicating them. Onboarding a new office is written as an honest checklist of real development work (new migration, satellite table, route, page, RBAC test coverage) rather than a false promise that it's a config toggle — this system has no such toggle, and pretending otherwise would be worse than saying so.

Two real bugs found only by actually running the offline install end to end, not by reading the Dockerfile or the session code:

1. **`backend/Dockerfile`'s runtime stage never copied `src/`.** `scripts/*.ts` (`provisionDbRoles.ts`, `rotateEncryptionKey.ts`, the new `manageStaffAccount.ts`) are run via `tsx` and `require('../src/...')` — that resolves fine on a host checkout (the full source tree is on disk), which is how every earlier phase had run them, but the trimmed runtime image only ever had `dist/`, `prisma/`, and `scripts/`. Running `provisionDbRoles.ts` inside the actual container — exactly what the offline install path does, since the target machine has no host Node.js — failed with `MODULE_NOT_FOUND`. Fixed by also copying `src/`, `tsconfig.json`, and `tsconfig.build.json` into the runtime image.
2. **The session cookie's `secure` flag was tied to `NODE_ENV === 'production'`**, not to whether TLS is actually present. `docker-compose.offline.yml` reasonably defaults `NODE_ENV=production` for a real deployment, which silently made the session cookie `Secure`-only — and this stack has no TLS termination anywhere; the target LGU server serves plain `http://`. Login returned a correct 200 response with the right JSON body (looks fine in a quick check), but no `Set-Cookie` header was ever sent, so `/auth/me` on the very next request came back `UNAUTHENTICATED` — every real login would have silently failed to establish a usable session on the actual target deployment. Fixed by decoupling the flag into its own `COOKIE_SECURE` env var (`backend/src/env.ts`, `backend/src/lib/session.ts`), defaulting to `false` to match how this stack actually ships, documented as opt-in for if/when a TLS-terminating reverse proxy is ever added in front of it.

Both fixes were re-verified by tearing down and re-running the entire clean-machine simulation from scratch, including a real login producing a working session cookie.

**Phase 9 and 10 changes were also re-validated against the full backend test suite** (188 tests, 14 files) run against fresh throwaway Postgres/MinIO containers matching the CI job exactly (`.github/workflows/ci.yml`'s env/services), not the already-running dev stack — all passing. (One flaky, unrelated Windows-only `vitest` worker-thread crash was hit and resolved by rerunning with `--pool=forks`; a full green run followed immediately after, and this isn't a Linux CI concern.)

This closes out `buildPrompt.txt`'s 10-phase spec. The one standing, previously-flagged gap: the Phase 7 masterlist/agri export is a general, well-structured LGU CSV, not verified against DILG DMS4LGUs's real field schema (no authoritative source for that schema was available) — flagged in the route/UI itself, not silently claimed as compliant.

## Beyond the original spec: adding new offices

The Phase 10 handoff doc treats "onboard a new office" as an honest checklist of real development work (new migration, satellite table, route, page, RBAC test coverage), not a config toggle — see [ops/HANDOFF.md](ops/HANDOFF.md).

Business Permits/Licensing was built and fully verified as the first proof of that checklist (new `business_permits_staff` role, `Business_Permit` table, RBAC grants + RLS, intake route, CSV export, RBAC test coverage extended in both `db/rbacMatrix.test.ts` and `routes/rbacMatrix.test.ts` — 277 tests passing) and then **deliberately removed**: it, along with Treasury (real property tax) and Assessor's Office, already has its own 3rd-party/external system of record generating the authoritative business count. Recording the same data again here would create a second, conflicting source of truth rather than a genuinely unified one. The removal itself followed the same discipline as the addition — a forward reversal migration (`20260827110000_remove_business_permits_office`, not a deleted history: drops the table, revokes and drops the role, and recreates the `StaffRole` enum without it, since Postgres has no `ALTER TYPE ... DROP VALUE`), re-verified against the full test suite.

Offices that genuinely belong in this system going forward are ones whose citizen records don't already live authoritatively somewhere else — Health/RHU is the clearer next candidate on that basis.
