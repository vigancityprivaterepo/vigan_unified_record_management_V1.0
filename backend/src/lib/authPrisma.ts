import { PrismaClient } from '@prisma/client';
import { env } from '../env';

// Connects as the app_service DB role: staff_account (read-only) and
// audit_log (insert-only) access, nothing else. The login/logout code path
// never touches this process's main `prisma` (migration-owner-scoped)
// client, so a bug here can't reach citizen data even in principle.
export const authPrisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrlForRole('app_service') } },
});
