# Backup & restore runbook

Two independent scheduled backups run as long-lived Compose services
(`backup`, `minio-backup`), both writing to bind-mounted host directories
(`backups/postgres/`, `backups/minio/`) so LGU IT staff can find and copy
files to external media without any Docker tooling. Defaults: daily
(`BACKUP_INTERVAL_SECONDS=86400`), 14-day retention
(`BACKUP_RETENTION_DAYS=14`) — override either in `.env` if the LGU wants a
different cadence.

Both procedures below were executed for real against a throwaway restore
target while building Phase 9, not just written — see the bugs section at
the bottom for what that caught.

## Postgres restore

The backup (`ops/pg_backup_loop.sh`) is `pg_dump --data-only`, deliberately
**not** a full schema+data dump: this project's schema (tables, extensions,
RBAC roles, grants, RLS policies) lives in Prisma migrations, which are the
source of truth. Restoring means recreating the schema from those migrations
first, then replaying data on top.

```bash
# 1. Fresh (or wiped) target database, then recreate the schema from the
#    same migrations that built the original:
cd backend
DATABASE_URL="postgresql://vigan:<db_password>@<host>:<port>/vigan_ucrms" \
  npx prisma migrate deploy

# 2. Provision the RBAC role passwords (creates them with a placeholder --
#    see docker/secrets/README.md#provisioning-the-rbac-role-passwords):
DATABASE_URL="postgresql://vigan:<db_password>@<host>:<port>/vigan_ucrms" \
  npm run db:provision-roles

# 3. `migrate deploy` seeds a couple of default app_setting rows via
#    `INSERT ... ON CONFLICT DO NOTHING` -- truncate every data table before
#    replaying the backup, or its own copy of those same rows collides:
psql -h <host> -p <port> -U vigan -d vigan_ucrms -c \
  'TRUNCATE TABLE app_setting, staff_account, barangay, "Citizen", "Persons_Senior", "Persons_PWD", "Persons_Solo_Parent", "Persons_Farmer", "Person_Birth", "Person_Death", duplicate_review_queue_item, audit_log CASCADE;'

# 4. Replay the dump. -v ON_ERROR_STOP=1 makes it fail loudly at the first
#    real problem instead of limping on:
LATEST=$(ls -t backups/postgres/*.sql.gz | head -1)
gunzip -c "$LATEST" | psql -h <host> -p <port> -U vigan -d vigan_ucrms -v ON_ERROR_STOP=1

# 5. Verify: row counts on a few tables should match the source, and spot-
#    check a specific record.
psql -h <host> -p <port> -U vigan -d vigan_ucrms -c 'SELECT count(*) FROM "Citizen";'
```

Two tables are permanently excluded from the dump itself
(`--exclude-table=_prisma_migrations --exclude-table=session` in the
`pg_dump` invocation), not just left out of the restore steps above:

- `_prisma_migrations` — records which migrations a *specific database
  instance* has applied. The restore target already has its own correct
  copy from its own `migrate deploy` in step 1; replaying the source's copy
  on top is both a duplicate-key conflict and semantically wrong (it
  describes the source, not the target).
- `session` — server-side session cookies. Transient by design; restoring
  old sessions onto a recovered server serves no purpose (everyone just
  logs in again) and revives tokens that should have expired.

## MinIO restore

The backup (`ops/minio_backup_loop.sh`) `tar`s the entire MinIO data
directory from a read-only volume mount — MinIO's own documented backup
approach for a standalone (single-node, single-drive) deployment, which is
what this project runs. No `mc mirror` / S3 API round trip needed.

```bash
# 1. Untar the backup into a fresh, empty volume/directory that will become
#    the new MinIO data dir:
LATEST=$(ls -t backups/minio/*.tar.gz | head -1)
tar xzf "$LATEST" -C <new-empty-data-dir>

# 2. Point a MinIO container at that directory (same MINIO_ROOT_USER /
#    MINIO_ROOT_PASSWORD_FILE the live stack uses -- root credentials come
#    from env at startup, not from the volume, so any valid credentials
#    work here for a disaster-recovery restore):
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=<user> -e MINIO_ROOT_PASSWORD=<password> \
  -v <new-empty-data-dir>:/data \
  minio/minio:RELEASE.2024-01-16T16-07-38Z server /data --console-address ":9001"

# 3. Verify: list the bucket, confirm object count and a spot-checked file
#    match what's expected.
mc alias set restored http://localhost:9000 <user> <password>
mc ls restored/vigan-documents/
```

## Reboot survival

`docker compose down` (without `-v`) followed by `docker compose up -d`
must bring the full stack back with no manual DB fixes — no re-running
migrations, no data loss. Both `pgdata` and `miniodata` are named Docker
volumes that outlive `down`; only `down -v` or an explicit `docker volume
rm` destroys them. Verified end-to-end while building Phase 9: took the
stack down and back up, and both the Postgres row count and the MinIO
object list were unchanged afterward with zero manual intervention.

MinIO volume persistence across a targeted recreate (e.g. after an image
upgrade) was verified the same way: `docker compose up -d --force-recreate
minio` with the object list unchanged before and after.

## Bugs found by actually testing the restore

Both of these would not have been caught by writing the backup script and
reasoning about it — only by standing up a genuinely separate database and
replaying a real backup into it end to end:

1. **`app_setting` seed conflict.** The Phase 2 migration seeds two default
   `app_setting` rows via `INSERT ... ON CONFLICT DO NOTHING` as part of
   `migrate deploy`. Replaying a data-only backup on top of a freshly
   migrated database hit those same primary keys already occupied — fixed
   by truncating data tables before replay (step 3 above).
2. **`_prisma_migrations` conflict.** `pg_dump --data-only` has no special
   awareness of Prisma's internal bookkeeping table and dumped it like any
   other. The restore target already has its own correct rows for it from
   its own `migrate deploy` — fixed by excluding it (and `session`, on the
   same transient-data reasoning) from the `pg_dump` invocation itself.
