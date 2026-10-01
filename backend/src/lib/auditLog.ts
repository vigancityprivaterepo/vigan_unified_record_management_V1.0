import type { Prisma, PrismaClient } from '@prisma/client';

type AuditAction = 'insert' | 'update' | 'delete' | 'read' | 'merge';

type AuditClient = Pick<PrismaClient, '$executeRaw'>;

export type AuditLogEntry = {
  tableName: string;
  recordId?: string | null;
  action: AuditAction;
  actorUserId?: string | null;
  actorRole?: string | null;
  changedFields?: Prisma.InputJsonValue | null;
};

// Postgres requires SELECT privilege on any column named in a RETURNING
// clause -- and Prisma Client's typed `.create()` always issues
// `INSERT ... RETURNING *` to hydrate its result. That's incompatible with
// audit_log's intentionally insert-only grant for every non-admin role (see
// the Phase 3 migration): a role that can write an audit entry but can't
// read audit_log back at all. Use this instead of `prisma.auditLog.create`
// for any write from a non-admin-scoped client.
export async function insertAuditLog(client: AuditClient, entry: AuditLogEntry): Promise<void> {
  await client.$executeRaw`
    INSERT INTO audit_log (table_name, record_id, action, actor_user_id, actor_role, changed_fields)
    VALUES (
      ${entry.tableName},
      ${entry.recordId ?? null}::uuid,
      ${entry.action}::"AuditAction",
      ${entry.actorUserId ?? null}::uuid,
      ${entry.actorRole ?? null},
      ${entry.changedFields != null ? JSON.stringify(entry.changedFields) : null}::jsonb
    )
  `;
}
