#!/bin/sh
# Runs in a plain alpine container that mounts the MinIO data volume
# read-only alongside a host backup directory -- deliberately NOT running
# inside the minio image itself, which doesn't ship general shell tooling.
# For a standalone (single-node, single-drive) MinIO deployment -- what
# this project runs -- tar'ing the data directory is MinIO's own documented
# backup approach; no `mc mirror`/S3-API round trip needed.
set -eu

BACKUP_DIR="/backups"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

while true; do
  TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  OUT_FILE="$BACKUP_DIR/minio_data_${TIMESTAMP}.tar.gz"

  echo "[minio-backup] $(date -u -Iseconds) starting backup -> $OUT_FILE"
  if tar czf "${OUT_FILE}.tmp" -C /data .; then
    mv "${OUT_FILE}.tmp" "$OUT_FILE"
    echo "[minio-backup] $(date -u -Iseconds) succeeded: $(du -h "$OUT_FILE" | cut -f1)"
  else
    echo "[minio-backup] $(date -u -Iseconds) FAILED" >&2
    rm -f "${OUT_FILE}.tmp"
  fi

  find "$BACKUP_DIR" -name 'minio_data_*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete

  sleep "$INTERVAL"
done
