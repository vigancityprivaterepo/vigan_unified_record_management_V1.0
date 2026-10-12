import fs from 'node:fs';

// Docker-secrets pattern: prefer *_FILE (path to a mounted secret file),
// fall back to a plain env var for local dev without Docker secrets.
// Never hardcode a default secret value here.
function readSecret(fileEnvVar: string, plainEnvVar: string): string {
  const filePath = process.env[fileEnvVar];
  if (filePath) {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }
  const value = process.env[plainEnvVar];
  if (!value) {
    throw new Error(`Missing secret: set ${fileEnvVar} or ${plainEnvVar}`);
  }
  return value;
}

// The Postgres LOGIN roles from the Phase 3 RBAC/RLS migration -- distinct
// from DATABASE_USER (the migration-owner superuser, "vigan" by default),
// which app code should never use for regular queries. office_staff is
// shared by every office (CSWD/Agriculture/Civil Registry included, as of
// the offices-as-modules unification -- see the schema.prisma comment
// above the Office model for why per-office DB roles don't scale).
export type DbRole = 'admin' | 'app_service' | 'office_staff';

const ROLE_ENV_PREFIX: Record<DbRole, string> = {
  admin: 'ADMIN',
  app_service: 'APP_SERVICE',
  office_staff: 'OFFICE_STAFF',
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  sessionIdleTimeoutMinutes: Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? 30),
  // Deliberately NOT tied to `nodeEnv === 'production'`: this is an
  // air-gapped LGU deployment with no TLS termination anywhere in the
  // stack (found by actually testing a login against the offline install --
  // NODE_ENV=production there made the session cookie Secure-only, which
  // silently breaks every login over the stack's plain http://). Defaults
  // to false (works on the plain-HTTP deployment this project actually
  // ships); set COOKIE_SECURE=true only if a TLS-terminating reverse proxy
  // is added in front of this stack.
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Frontend origins allowed to make credentialed (cookie-bearing) CORS
  // requests, comma-separated. Vite dev server default; override in Docker/prod.
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  // 'minio' (default, Docker stack) or 'local' (folder on the server).
  documentStorage: process.env.DOCUMENT_STORAGE === 'local' ? ('local' as const) : ('minio' as const),
  documentDir: process.env.DOCUMENT_DIR ?? 'storage/documents',
  minioEndpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  minioPort: Number(process.env.MINIO_PORT ?? 9000),
  minioAccessKey: process.env.MINIO_ACCESS_KEY ?? 'vigan_admin',
  // Reuses the db_password secret, same as docker-compose's
  // MINIO_ROOT_PASSWORD_FILE -- one shared root credential for local/small
  // deployments, not a separate MinIO-specific secret.
  get minioSecretKey(): string {
    return this.dbPassword;
  },

  get dbPassword(): string {
    return readSecret('DB_PASSWORD_FILE', 'DB_PASSWORD');
  },
  get sessionSecret(): string {
    return readSecret('SESSION_SECRET_FILE', 'SESSION_SECRET');
  },
  get encryptionKey(): string {
    return readSecret('ENCRYPTION_KEY_FILE', 'ENCRYPTION_KEY');
  },
  rolePassword(role: DbRole): string {
    const prefix = ROLE_ENV_PREFIX[role];
    return readSecret(`${prefix}_DB_PASSWORD_FILE`, `${prefix}_DB_PASSWORD`);
  },

  // In Docker, built from DATABASE_HOST/PORT/NAME/USER + the DB_PASSWORD
  // secret. Locally (tests, host-run dev server), set DATABASE_URL directly
  // and it's used as-is.
  get databaseUrl(): string {
    if (process.env.DATABASE_URL) {
      return process.env.DATABASE_URL;
    }
    const host = process.env.DATABASE_HOST ?? 'localhost';
    const port = process.env.DATABASE_PORT ?? '5432';
    const name = process.env.DATABASE_NAME ?? 'vigan_ucrms';
    const user = process.env.DATABASE_USER ?? 'vigan';
    const password = encodeURIComponent(this.dbPassword);
    return `postgresql://${user}:${password}@${host}:${port}/${name}?schema=public`;
  },

  // Same host/port/db as databaseUrl, but connecting as one of the five
  // RBAC roles instead of the migration-owner superuser.
  databaseUrlForRole(role: DbRole): string {
    const host = process.env.DATABASE_HOST ?? 'localhost';
    const port = process.env.DATABASE_PORT ?? '5432';
    const name = process.env.DATABASE_NAME ?? 'vigan_ucrms';
    const password = encodeURIComponent(this.rolePassword(role));
    return `postgresql://${role}:${password}@${host}:${port}/${name}?schema=public`;
  },
};
