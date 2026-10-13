import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { getBridgeStatus, syncAics } from '../services/aicsBridge';

// The connection to the AICS system (see services/aicsBridge.ts): when it
// last pulled and what it brought in, and a way to pull now.
export const adminAicsBridgeRouter = Router();
adminAicsBridgeRouter.use(requireRole('admin'));

adminAicsBridgeRouter.get('/', asyncHandler(async (_req, res) => {
  res.json(await getBridgeStatus());
}));

adminAicsBridgeRouter.post('/sync', asyncHandler(async (req, res) => {
  const status = await getBridgeStatus();
  if (!status.configured) { sendError(res, 409, 'NOT_CONFIGURED', 'The AICS connection is not set up on this server'); return; }
  if (status.running) { sendError(res, 409, 'ALREADY_RUNNING', 'A sync with AICS is already running'); return; }
  const client = getPrismaForRole('admin');
  try {
    const result = await syncAics(client);
    await insertAuditLog(client, {
      tableName: 'office_record', recordId: null, action: 'insert', actorUserId: req.session.userId, actorRole: req.session.role,
      changedFields: { event: 'aics_sync', ...result },
    });
    res.json(await getBridgeStatus());
  } catch (err) {
    sendError(res, 502, 'AICS_UNREACHABLE', err instanceof Error ? err.message : 'The sync with AICS failed');
  }
}));
