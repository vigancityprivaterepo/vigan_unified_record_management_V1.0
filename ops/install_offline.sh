#!/bin/sh
# Run on the target LGU server -- no internet access required or used at
# any point in this script. Expects to be run from inside the extracted
# offline-bundle/ directory (the one ops/build_offline_bundle.sh produced).
#
# What "no internet access" means here, concretely: every image this
# script needs is `docker load`ed from a local .tar.gz, never `docker
# pull`ed. docker-compose.offline.yml sets `pull_policy: never` on every
# service, so if a load step were skipped or a tag mismatched, `compose up`
# fails immediately with a clear error instead of silently reaching for a
# registry that isn't reachable anyway.
set -eu

BUNDLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BUNDLE_DIR"

if [ ! -f .bundle-version ]; then
  echo "install_offline.sh must be run from inside an offline-bundle/ directory (missing .bundle-version)" >&2
  exit 1
fi
. ./.bundle-version
export OFFLINE_IMAGE_TAG="$IMAGE_TAG"

echo "[install] loading images (tag ${OFFLINE_IMAGE_TAG})..."
for f in images/*.tar.gz; do
  echo "[install]   $f"
  gunzip -c "$f" | docker load
done

echo "[install] checking secrets..."
NEED_SECRETS=0
for name in db_password session_secret encryption_key cswd_staff_db_password agri_staff_db_password civil_registry_staff_db_password admin_db_password app_service_db_password; do
  if [ ! -s "docker/secrets/${name}.txt" ]; then
    NEED_SECRETS=1
  fi
done

if [ "$NEED_SECRETS" -eq 1 ]; then
  echo "[install] one or more docker/secrets/*.txt missing -- generating fresh random values."
  echo "[install] (see docker/secrets/README.md if you'd rather set these yourself first, e.g. from an existing backup's key material.)"
  for name in db_password session_secret encryption_key cswd_staff_db_password agri_staff_db_password civil_registry_staff_db_password admin_db_password app_service_db_password; do
    if [ ! -s "docker/secrets/${name}.txt" ]; then
      openssl rand -base64 32 | tr -d '\n' > "docker/secrets/${name}.txt"
    fi
  done
else
  echo "[install] secrets already present, leaving them as-is."
fi

echo "[install] starting the stack..."
docker compose -f docker-compose.offline.yml up -d

echo "[install] waiting for postgres and minio to report healthy..."
i=0
while [ "$i" -lt 60 ]; do
  PG_STATUS=$(docker compose -f docker-compose.offline.yml ps postgres --format '{{.Health}}' 2>/dev/null || echo '')
  MINIO_STATUS=$(docker compose -f docker-compose.offline.yml ps minio --format '{{.Health}}' 2>/dev/null || echo '')
  if [ "$PG_STATUS" = "healthy" ] && [ "$MINIO_STATUS" = "healthy" ]; then
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$PG_STATUS" != "healthy" ] || [ "$MINIO_STATUS" != "healthy" ]; then
  echo "[install] postgres/minio did not become healthy in time -- check 'docker compose -f docker-compose.offline.yml logs'" >&2
  exit 1
fi

echo "[install] running database migrations + RBAC role provisioning inside the backend container (no host Node.js needed -- both ship inside the already-loaded backend image)..."
docker compose -f docker-compose.offline.yml exec -T backend sh -c '
  PW=$(node -e "console.log(encodeURIComponent(require(\"fs\").readFileSync(process.env.DB_PASSWORD_FILE,\"utf-8\").trim()))")
  export DATABASE_URL="postgresql://${DATABASE_USER}:${PW}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}?schema=public"
  npx prisma migrate deploy
  npx tsx scripts/provisionDbRoles.ts
'

echo "[install] done. Stack is up: frontend on \${FRONTEND_PORT:-5173}, backend on \${BACKEND_PORT:-4000}."
echo "[install] next: create real staff accounts -- see ops/HANDOFF.md#role-management (there is no default/demo login in this install path, unlike the dev seed)."
