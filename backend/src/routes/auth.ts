import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authPrisma } from '../lib/authPrisma';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';

export type LoginRateLimitOptions = {
  windowMs: number;
  limit: number;
};

const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 30,
};

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Factory (like createApp itself) so tests can inject a tiny window/limit
// instead of waiting out a real 15-minute one. Keyed by IP (the default
// keyGenerator), not by username -- a per-username lockout would let anyone
// lock out a coworker just by repeatedly guessing their username.
export function createAuthRouter(options?: { loginRateLimit?: LoginRateLimitOptions }): Router {
  const authRouter = Router();
  const loginLimiter = rateLimit({
    ...(options?.loginRateLimit ?? DEFAULT_LOGIN_RATE_LIMIT),
    standardHeaders: true,
    legacyHeaders: false,
    // Only failed attempts count toward the limit -- this throttles password
    // guessing, not a shared front-desk workstation's normal run of
    // legitimate repeat logins across a shift.
    skipSuccessfulRequests: true,
  });

  // No AuditAction value maps cleanly to "session created/destroyed" -- these
  // don't insert/update/delete a citizen-domain row, so both login and
  // logout are logged as 'read' against staff_account, with changedFields
  // distinguishing the event.
  authRouter.post('/login', loginLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid login payload', parsed.error.flatten());
      return;
    }
    const { username, password } = parsed.data;

    const account = await authPrisma.staffAccount.findUnique({ where: { username } });
    if (!account || !account.isActive || !(await bcrypt.compare(password, account.passwordHash))) {
      await insertAuditLog(authPrisma, {
        tableName: 'staff_account',
        recordId: account?.id ?? null,
        action: 'read',
        actorUserId: null,
        actorRole: null,
        changedFields: { event: 'login_failed', username },
      });
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');
      return;
    }

    req.session.regenerate(async (regenErr) => {
      if (regenErr) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Failed to establish session');
        return;
      }

      try {
        req.session.userId = account.id;
        req.session.username = account.username;
        req.session.fullName = account.fullName;
        req.session.position = account.position ?? undefined;
        req.session.role = account.role;
        req.session.officeId = account.officeId ?? undefined;

        await insertAuditLog(authPrisma, {
          tableName: 'staff_account',
          recordId: account.id,
          action: 'read',
          actorUserId: account.id,
          actorRole: account.role,
          changedFields: { event: 'login' },
        });

        res.json({
          userId: account.id,
          username: account.username,
          fullName: account.fullName,
          position: account.position,
          role: account.role,
          officeId: account.officeId,
        });
      } catch {
        // An error here would otherwise be an unhandled rejection inside this
        // callback -- Express never sees it, and the request hangs instead
        // of failing.
        sendError(res, 500, 'INTERNAL_ERROR', 'Failed to establish session');
      }
    });
  });

  authRouter.post('/logout', requireAuth, (req, res) => {
    const { userId, role } = req.session;

    req.session.destroy(async (err) => {
      if (err) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Failed to log out');
        return;
      }
      try {
        if (userId) {
          await insertAuditLog(authPrisma, {
            tableName: 'staff_account',
            recordId: userId,
            action: 'read',
            actorUserId: userId,
            actorRole: role,
            changedFields: { event: 'logout' },
          });
        }
        res.clearCookie('connect.sid');
        res.status(204).send();
      } catch {
        sendError(res, 500, 'INTERNAL_ERROR', 'Failed to log out');
      }
    });
  });

  authRouter.get('/me', requireAuth, (req, res) => {
    res.json({
      userId: req.session.userId,
      username: req.session.username,
      // Sessions from before fullName was stored fall back to the username.
      fullName: req.session.fullName ?? req.session.username,
      position: req.session.position ?? null,
      role: req.session.role,
      officeId: req.session.officeId,
    });
  });

  return authRouter;
}
