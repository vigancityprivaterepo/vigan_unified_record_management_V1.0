import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { getHeritageBarangays, heritageSummary, setHeritageBarangays } from '../services/heritageZone';

// Heritage zone (services/heritageZone.ts), admin only: the summary, and the
// setting that marks which barangays are inside the zone.
export const adminHeritageRouter = Router();
adminHeritageRouter.use(requireRole('admin'));

adminHeritageRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const client = getPrismaForRole('admin');
    const [summary, all] = await Promise.all([heritageSummary(client), client.barangay.findMany({ select: { code: true, name: true }, orderBy: { name: 'asc' } })]);
    res.json({ ...summary, allBarangays: all });
  }),
);

adminHeritageRouter.put(
  '/barangays',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ codes: z.array(z.string().trim().min(1).max(20)).max(100) }).safeParse(req.body);
    if (!parsed.success) { sendError(res, 400, 'VALIDATION_ERROR', 'codes must be a list of barangay codes'); return; }
    const client = getPrismaForRole('admin');
    const known = await client.barangay.count({ where: { code: { in: parsed.data.codes } } });
    if (known !== new Set(parsed.data.codes).size) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown barangay'); return; }
    const before = await getHeritageBarangays();
    await setHeritageBarangays(parsed.data.codes, req.session.userId!);
    await insertAuditLog(client, {
      tableName: 'app_setting', recordId: null, action: 'update', actorUserId: req.session.userId, actorRole: req.session.role,
      changedFields: { key: 'HERITAGE_ZONE_BARANGAYS', before, after: parsed.data.codes },
    });
    res.json({ codes: parsed.data.codes });
  }),
);
