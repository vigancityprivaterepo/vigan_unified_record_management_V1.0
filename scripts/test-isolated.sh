#!/usr/bin/env bash
# Runs the backend test suite against a throwaway Postgres container, never
# the dev/production database. The tests DELETE citizens, records, widgets and
# audit logs (src/testUtils/resetDb.ts), so they must not touch real data.
#
# Mirrors .github/workflows/ci.yml: migrate -> provision roles -> seed demo
# accounts -> vitest. All passwords below are throwaway test-only values.
# The container is removed at the end, pass or fail.
#
# Usage (from the repo root, Docker running):  bash scripts/test-isolated.sh
set -euo pipefail

PORT=5434
NAME=vucrms-test-pg
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC_DIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DOC_DIR"
}
trap cleanup EXIT

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" \
  -e POSTGRES_USER=vigan -e POSTGRES_PASSWORD=test_only_not_a_secret -e POSTGRES_DB=vigan_ucrms \
  postgres:15.8-alpine >/dev/null
until docker exec "$NAME" pg_isready -U vigan -d vigan_ucrms >/dev/null 2>&1; do sleep 1; done
sleep 2 # first boot restarts the server once after init

# Only these variables reach the tests (env -i): nothing from backend/.env
# or the shell can point them at the real database.
run() {
  env -i PATH="$PATH" SYSTEMROOT="${SYSTEMROOT:-}" APPDATA="${APPDATA:-}" LOCALAPPDATA="${LOCALAPPDATA:-}" \
    TEMP="${TEMP:-/tmp}" TMP="${TMP:-/tmp}" USERPROFILE="${USERPROFILE:-}" HOME="${HOME:-}" \
    NODE_ENV=test \
    DATABASE_URL="postgresql://vigan:test_only_not_a_secret@127.0.0.1:${PORT}/vigan_ucrms?schema=public" \
    DATABASE_HOST=127.0.0.1 DATABASE_PORT="$PORT" DATABASE_NAME=vigan_ucrms \
    DB_PASSWORD=test_only_not_a_secret \
    ADMIN_DB_PASSWORD=test_only_admin APP_SERVICE_DB_PASSWORD=test_only_app_service OFFICE_STAFF_DB_PASSWORD=test_only_office_staff \
    CSWD_STAFF_DB_PASSWORD=test_only_cswd AGRI_STAFF_DB_PASSWORD=test_only_agri CIVIL_REGISTRY_STAFF_DB_PASSWORD=test_only_civreg \
    SESSION_SECRET=test_only_session_secret ENCRYPTION_KEY=test_only_encryption_key_not_a_secret \
    DOCUMENT_STORAGE=local DOCUMENT_DIR="$DOC_DIR" \
    "$@"
}

# Safety check: refuse to continue unless the URL the tests will see is the
# throwaway port.
run node -e "const u=process.env.DATABASE_URL; if(!u.includes('127.0.0.1:${PORT}/')) { console.error('refusing: ' + u.replace(/:[^:@]*@/, ':***@')); process.exit(1); }"

cd "$ROOT/backend"
run npx prisma migrate deploy
run npx tsx scripts/provisionDbRoles.ts
run npx tsx prisma/seed.ts
run npx vitest run --pool=forks "$@"
