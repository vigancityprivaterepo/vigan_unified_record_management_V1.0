import type { RequestHandler } from 'express';
import type { StaffRole } from '@prisma/client';
import { sendError } from '../lib/errors';

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Login required');
    return;
  }
  next();
};

export function requireRole(...roles: StaffRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.session.userId) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Login required');
      return;
    }
    if (!req.session.role || !roles.includes(req.session.role)) {
      sendError(res, 403, 'FORBIDDEN', 'Insufficient role for this action');
      return;
    }
    next();
  };
}

// Every office (CSWD/Agriculture/Civil Registry included, as of the
// offices-as-modules unification) shares one Postgres role (office_staff)
// instead of one role each, so isolation between offices isn't enforced at
// the DB grant level -- this middleware is what actually enforces it: an
// office_staff session can only reach routes whose :officeId param matches
// the office it was logged into. admin bypasses the check.
export const requireOfficeAccess: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Login required');
    return;
  }
  if (req.session.role === 'admin') {
    next();
    return;
  }
  if (req.session.role === 'office_staff' && req.session.officeId === req.params.officeId) {
    next();
    return;
  }
  sendError(res, 403, 'FORBIDDEN', 'Insufficient role for this action');
};
