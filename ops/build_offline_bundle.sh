#!/bin/sh
# Run on a machine WITH internet access (a dev laptop, a build server) --
# never on the target LGU server. Builds the backend/frontend images,
# `docker save`s every image the stack needs (including the two pinned
# base images that don't need building, postgres and alpine -- minio's own
# image counts as pinned too), and assembles offline-bundle/ into a
# self-contained directory that ops/install_offline.sh can run against with
# zero network access.
#
# Usage: ops/build_offline_bundle.sh [image-tag]
#   image-tag defaults to 1.0.0 -- must match OFFLINE_IMAGE_TAG when
#   install_offline.sh runs on the target machine (default there is also
#   1.0.0, so this only needs to be passed explicitly if cutting a new
#   version).
set -eu

TAG="${1:-1.0.0}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/offline-bundle"

echo "[build-bundle] building backend/frontend images tagged ${TAG}..."
cd "$ROOT_DIR"
docker build -t "vigan-ucrms-backend:${TAG}" ./backend
docker build -t "vigan-ucrms-frontend:${TAG}" ./frontend

echo "[build-bundle] pulling pinned base images (already pinned, no :latest)..."
docker pull postgres:15.8-alpine
docker pull minio/minio:RELEASE.2024-01-16T16-07-38Z
docker pull alpine:3.20

rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/images" "$BUNDLE_DIR/ops" "$BUNDLE_DIR/docker/secrets"

echo "[build-bundle] saving images to ${BUNDLE_DIR}/images (this takes a while)..."
docker save "vigan-ucrms-backend:${TAG}" | gzip > "$BUNDLE_DIR/images/backend.tar.gz"
docker save "vigan-ucrms-frontend:${TAG}" | gzip > "$BUNDLE_DIR/images/frontend.tar.gz"
docker save postgres:15.8-alpine | gzip > "$BUNDLE_DIR/images/postgres.tar.gz"
docker save minio/minio:RELEASE.2024-01-16T16-07-38Z | gzip > "$BUNDLE_DIR/images/minio.tar.gz"
docker save alpine:3.20 | gzip > "$BUNDLE_DIR/images/alpine.tar.gz"

echo "[build-bundle] copying compose file, backup scripts, docs, install script..."
cp "$ROOT_DIR/docker-compose.offline.yml" "$BUNDLE_DIR/docker-compose.offline.yml"
cp "$ROOT_DIR/ops/pg_backup_loop.sh" "$BUNDLE_DIR/ops/pg_backup_loop.sh"
cp "$ROOT_DIR/ops/minio_backup_loop.sh" "$BUNDLE_DIR/ops/minio_backup_loop.sh"
cp "$ROOT_DIR/ops/install_offline.sh" "$BUNDLE_DIR/ops/install_offline.sh"
cp "$ROOT_DIR/ops/README.md" "$BUNDLE_DIR/ops/README.md"
cp "$ROOT_DIR/ops/HANDOFF.md" "$BUNDLE_DIR/ops/HANDOFF.md"
cp "$ROOT_DIR/docker/secrets/README.md" "$BUNDLE_DIR/docker/secrets/README.md"
mkdir -p "$BUNDLE_DIR/backups/postgres" "$BUNDLE_DIR/backups/minio"

echo "IMAGE_TAG=${TAG}" > "$BUNDLE_DIR/.bundle-version"

echo "[build-bundle] done. Bundle at: $BUNDLE_DIR"
echo "[build-bundle] copy the whole offline-bundle/ directory to the target machine (USB drive, etc.) and run ops/install_offline.sh there."
du -sh "$BUNDLE_DIR"
