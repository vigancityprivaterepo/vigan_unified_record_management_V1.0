import { PrismaClient, type StaffRole } from '@prisma/client';
import { env } from '../env';

// One PrismaClient (one connection pool) per RBAC role, created lazily and
// reused -- office route handlers use the client matching the
// authenticated session's role, so every citizen-domain query actually
// runs under that role's Postgres grants, not the migration-owner
// superuser. StaffRole's four values are a subset of env's five DbRole
// values (everything except app_service, which is auth-subsystem only).
const clients = new Map<StaffRole, PrismaClient>();

// A 'viewer' has no Postgres role of its own. The only routes it reaches are
// the read-only, counts-only ones listed in middleware/auth.ts, which were
// written for admin, so it reads through the admin connection.
export function getPrismaForRole(role: StaffRole): PrismaClient {
  const dbRole = role === 'viewer' ? 'admin' : role;
  let client = clients.get(dbRole);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: env.databaseUrlForRole(dbRole) } } });
    clients.set(dbRole, client);
  }
  return client;
}
