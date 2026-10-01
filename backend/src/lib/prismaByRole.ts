import { PrismaClient, type StaffRole } from '@prisma/client';
import { env } from '../env';

// One PrismaClient (one connection pool) per RBAC role, created lazily and
// reused -- office route handlers use the client matching the
// authenticated session's role, so every citizen-domain query actually
// runs under that role's Postgres grants, not the migration-owner
// superuser. StaffRole's four values are a subset of env's five DbRole
// values (everything except app_service, which is auth-subsystem only).
const clients = new Map<StaffRole, PrismaClient>();

export function getPrismaForRole(role: StaffRole): PrismaClient {
  let client = clients.get(role);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: env.databaseUrlForRole(role) } } });
    clients.set(role, client);
  }
  return client;
}
