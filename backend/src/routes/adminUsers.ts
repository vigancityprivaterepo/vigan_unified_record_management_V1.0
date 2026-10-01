import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { insertAuditLog } from '../lib/auditLog';
import { asyncHandler } from '../lib/asyncHandler';
import { sendError } from '../lib/errors';
import { killSessionsForUser } from '../lib/killSession';
import { getPrismaForRole } from '../lib/prismaByRole';
import { generatePassword, hashPassword } from '../lib/staffAccountCredentials';
import { requireRole } from '../middleware/auth';

// Staff account management via the web app -- the admin-role counterpart to
// scripts/manageStaffAccount.ts (see that file's header, and migration
// 20260827090000_grant_staff_account_to_admin, for why this exists as an
// HTTP surface at all and what trade-off that decision made).
export const adminUsersRouter = Router();
adminUsersRouter.use(requireRole('admin'));

const STAFF_ROLES = ['admin', 'office_staff'] as const;

const STAFF_LIST_SELECT = {
  id: true,
  username: true,
  fullName: true,
  position: true,
  role: true,
  officeId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

adminUsersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const client = getPrismaForRole('admin');
    const [accounts, lastLogins] = await Promise.all([
      client.staffAccount.findMany({
        select: STAFF_LIST_SELECT,
        orderBy: [{ role: 'asc' }, { username: 'asc' }],
      }),
      // Last successful sign-in per account, from auth.ts's login audit rows
      // (no column on staff_account tracks it).
      client.$queryRaw<Array<{ record_id: string; at: Date }>>`
        SELECT record_id, max("timestamp") AS at FROM audit_log
        WHERE table_name = 'staff_account' AND changed_fields->>'event' = 'login' AND record_id IS NOT NULL
        GROUP BY record_id`,
    ]);
    const lastLoginById = new Map(lastLogins.map((l) => [l.record_id, l.at]));
    res.json(accounts.map((a) => ({ ...a, lastSignInAt: lastLoginById.get(a.id) ?? null })));
  }),
);

const createSchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    fullName: z.string().trim().min(1).max(200),
    position: z.string().trim().max(120).optional(),
    role: z.enum(STAFF_ROLES),
    officeId: z.string().uuid().optional(),
    // Admin can set the account's password directly instead of only ever
    // getting a generated one -- left blank, one is still generated same
    // as before.
    password: z.string().min(8).max(200).optional(),
  })
  // office_staff has no fixed office of its own -- which office an account
  // belongs to is a runtime choice, assigned per account, not encoded in
  // the role name (every non-admin staff account is office_staff now).
  .refine((data) => data.role !== 'office_staff' || !!data.officeId, {
    message: 'officeId is required when role is office_staff',
    path: ['officeId'],
  });

adminUsersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid staff account payload', parsed.error.flatten());
      return;
    }
    const { username, fullName, role } = parsed.data;
    const position = parsed.data.position || null;
    const officeId = role === 'office_staff' ? parsed.data.officeId : undefined;
    const client = getPrismaForRole('admin');

    const existing = await client.staffAccount.findUnique({ where: { username } });
    if (existing) {
      sendError(res, 409, 'USERNAME_TAKEN', `"${username}" is already in use`);
      return;
    }

    if (officeId) {
      const office = await client.office.findUnique({ where: { id: officeId } });
      if (!office) {
        sendError(res, 400, 'VALIDATION_ERROR', 'No such office', { officeId: ['No such office'] });
        return;
      }
    }

    const password = parsed.data.password ?? generatePassword();
    const passwordHash = await hashPassword(password);

    const created = await client.staffAccount.create({
      data: { username, fullName, position, role, officeId, passwordHash },
      select: STAFF_LIST_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'staff_account',
      recordId: created.id,
      action: 'insert',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { username, fullName, position, role, officeId },
    });

    // The one and only time this password exists outside its bcrypt hash --
    // never logged, never stored, gone once this response is sent.
    res.status(201).json({ account: created, oneTimePassword: password });
  }),
);

const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  // Empty string or null clears it; omitted leaves it unchanged.
  position: z.string().trim().max(120).nullable().optional(),
  role: z.enum(STAFF_ROLES).optional(),
  // Explicit null clears it (switching to admin) -- omitted leaves whatever
  // office the account already has.
  officeId: z.string().uuid().nullable().optional(),
});

// Edits an existing account's profile -- username is deliberately not
// editable here (it's the login identifier; changing it is a bigger
// operation than this form implies, not offered until something actually
// needs it). Password changes go through /reset-password instead, and
// active/inactive through /deactivate /reactivate, both already
// self-contained actions with their own audit trail.
adminUsersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid staff account payload', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole('admin');
    const existing = await client.staffAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such staff account');
      return;
    }

    const nextRole = parsed.data.role ?? existing.role;
    if (existing.id === req.session.userId && nextRole !== 'admin') {
      sendError(res, 400, 'SELF_DEMOTION', 'You cannot change your own role away from admin -- have another admin do it');
      return;
    }

    // officeId resolution: explicit value (including null) wins; otherwise
    // keep the existing one, except a role landing on 'admin' always clears
    // it -- an office_staff moved to admin over admin's whole-system scope
    // shouldn't be left pointing at their old office.
    let officeId: string | null | undefined = parsed.data.officeId;
    if (officeId === undefined) officeId = nextRole === 'admin' ? null : existing.officeId;
    if (nextRole === 'admin') officeId = null;
    if (nextRole === 'office_staff' && !officeId) {
      sendError(res, 400, 'VALIDATION_ERROR', 'officeId is required when role is office_staff', {
        officeId: ['Required for office_staff'],
      });
      return;
    }
    if (officeId) {
      const office = await client.office.findUnique({ where: { id: officeId } });
      if (!office) {
        sendError(res, 400, 'VALIDATION_ERROR', 'No such office', { officeId: ['No such office'] });
        return;
      }
    }

    const updated = await client.staffAccount.update({
      where: { id: req.params.id },
      data: {
        fullName: parsed.data.fullName,
        ...(parsed.data.position !== undefined ? { position: parsed.data.position || null } : {}),
        role: nextRole,
        officeId,
      },
      select: STAFF_LIST_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'staff_account',
      recordId: updated.id,
      action: 'update',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: {
        fullName: parsed.data.fullName,
        ...(parsed.data.position !== undefined ? { position: parsed.data.position || null, previousPosition: existing.position } : {}),
        role: parsed.data.role,
        officeId,
      },
    });

    res.json(updated);
  }),
);

adminUsersRouter.patch(
  '/:id/deactivate',
  asyncHandler(async (req, res) => {
    await setActive(req, res, false);
  }),
);

adminUsersRouter.patch(
  '/:id/reactivate',
  asyncHandler(async (req, res) => {
    await setActive(req, res, true);
  }),
);

async function setActive(req: Request, res: Response, isActive: boolean): Promise<void> {
  const client = getPrismaForRole('admin');
  const existing = await client.staffAccount.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    sendError(res, 404, 'NOT_FOUND', 'No such staff account');
    return;
  }
  if (!isActive && existing.id === req.session.userId) {
    sendError(res, 400, 'SELF_DEACTIVATION', 'You cannot deactivate your own account -- have another admin do it');
    return;
  }

  const updated = await client.staffAccount.update({
    where: { id: req.params.id },
    data: { isActive },
    select: STAFF_LIST_SELECT,
  });

  await insertAuditLog(client, {
    tableName: 'staff_account',
    recordId: updated.id,
    action: 'update',
    actorUserId: req.session.userId,
    actorRole: req.session.role,
    changedFields: { isActive },
  });

  if (!isActive) {
    // Best-effort: the account is already deactivated and audit-logged, so a
    // failure here shouldn't fail the response -- worst case the session
    // rides out the normal idle timeout instead of being killed immediately.
    try {
      await killSessionsForUser(updated.id);
    } catch (err) {
      console.error('Failed to kill sessions for deactivated account', updated.id, err);
    }
  }

  res.json(updated);
}

// Hard delete, unlike deactivate -- no FK anywhere in the schema points at
// staff_account (checked directly: only staff_account itself has an
// outgoing FK, to office), so this can't fail on referential integrity.
// It does mean this account's audit_log rows keep an actor_user_id that no
// longer resolves to anything -- deactivate is the reversible, trail-
// preserving option; this is for a truly mistaken account, not routine
// offboarding.
adminUsersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const existing = await client.staffAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such staff account');
      return;
    }
    if (existing.id === req.session.userId) {
      sendError(res, 400, 'SELF_DELETION', 'You cannot delete your own account -- have another admin do it');
      return;
    }

    await client.staffAccount.delete({ where: { id: req.params.id } });

    await insertAuditLog(client, {
      tableName: 'staff_account',
      recordId: existing.id,
      action: 'delete',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { username: existing.username },
    });

    try {
      await killSessionsForUser(existing.id);
    } catch (err) {
      console.error('Failed to kill sessions for deleted account', existing.id, err);
    }

    res.status(204).send();
  }),
);

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(200),
});

adminUsersRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid reset-password payload', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole('admin');
    const existing = await client.staffAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such staff account');
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await client.staffAccount.update({ where: { id: req.params.id }, data: { passwordHash } });

    await insertAuditLog(client, {
      tableName: 'staff_account',
      recordId: existing.id,
      action: 'update',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { passwordReset: true },
    });

    res.status(204).send();
  }),
);
