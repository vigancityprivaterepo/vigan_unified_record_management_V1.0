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

// What a 'viewer' account (the mayor, other city officials) may open: the
// city-wide pages that show counts and charts. Everything else is refused,
// in particular anything that lists people (citizens, households, the names
// behind a program gap or a chart, exports) and every change. Adding a page
// for officials means adding its route here, on purpose.
const ID = '[0-9a-f-]{36}';
const VIEWER_CAN_READ: RegExp[] = [
  /^\/admin\/dashboard\/summary$/,
  /^\/admin\/insights\/(summary|sankey|barangay-ranking|trend|office-breakdown|questions|attention)$/,
  /^\/admin\/dashboard\/widgets$/,
  new RegExp(`^/admin/dashboard/widgets/${ID}/(data|explore/history|explore/profile)$`),
  /^\/admin\/offices$/,
  new RegExp(`^/admin/offices/${ID}/modules$`),
  /^\/admin\/program-gaps$/,
  /^\/admin\/assistance$/,
];

export function viewerMayRead(method: string, url: string): boolean {
  const path = (url.split('?')[0] ?? '').replace(/\/+$/, '');
  return method === 'GET' && VIEWER_CAN_READ.some((re) => re.test(path));
}

export function requireRole(...roles: StaffRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.session.userId) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Login required');
      return;
    }
    if (req.session.role === 'viewer' && roles.includes('admin') && viewerMayRead(req.method, req.originalUrl)) {
      next();
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
