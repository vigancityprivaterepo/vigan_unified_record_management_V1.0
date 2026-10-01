#!/bin/sh
# Runs inside the `backup` service (postgres:15.8-alpine, so pg_dump/gzip are
# already present -- no extra image needed). Loops forever: dump, prune,
# sleep. Plain SQL + gzip, not pg_dump's custom -Fc format -- inspectable
# with plain `zcat`/`less` by anyone doing LGU IT support, no pg_restore
# tooling required to even look at what's in a given backup file.
#
# --data-only, deliberately: this project's schema (tables, extensions,
# RBAC roles, grants, RLS policies) is Prisma migrations, not this backup --
# a full schema+data dump would fight `prisma migrate deploy` on restore
# (duplicate CREATE TABLE) and can't recreate roles at all (pg_dump only
# dumps database-level objects, not cluster-level roles). The restore
# runbook (ops/README.md) is: fresh DB -> `prisma migrate deploy` ->
# `db:provision-roles` -> truncate the seeded defaults -> replay this dump.
#
# Two tables are excluded entirely, both found by actually testing a
# restore rather than by inspection:
#   - _prisma_migrations: records which migrations a *specific* database
#     instance has applied. The restore target gets its own copy of this
#     from its own `migrate deploy` -- replaying the source's copy on top
#     is a duplicate-key conflict, and semantically wrong regardless (it
#     describes the source database, not the one being restored into).
#   - session: server-side session cookies. Transient by design; restoring
#     old sessions onto a recovered server serves no purpose (everyone
#     just logs in again) and is arguably a minor security smell (reviving
#     session tokens that should have expired).
set -eu

BACKUP_DIR="/backups"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

while true; do
  export PGPASSWORD
  PGPASSWORD="$(cat /run/secrets/db_password)"

  TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  OUT_FILE="$BACKUP_DIR/vigan_ucrms_${TIMESTAMP}.sql.gz"

  echo "[pg-backup] $(date -u -Iseconds) starting backup -> $OUT_FILE"
  if pg_dump -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" --format=plain --data-only --disable-triggers \
      --exclude-table=_prisma_migrations --exclude-table=session \
      | gzip > "${OUT_FILE}.tmp"; then
    mv "${OUT_FILE}.tmp" "$OUT_FILE"
    echo "[pg-backup] $(date -u -Iseconds) succeeded: $(du -h "$OUT_FILE" | cut -f1)"
  else
    echo "[pg-backup] $(date -u -Iseconds) FAILED" >&2
    rm -f "${OUT_FILE}.tmp"
  fi

  find "$BACKUP_DIR" -name 'vigan_ucrms_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

  sleep "$INTERVAL"
done
