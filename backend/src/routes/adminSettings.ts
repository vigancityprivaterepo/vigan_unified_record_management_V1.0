import { Router } from 'express';
import { z } from 'zod';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { getSetting, setSetting } from '../services/config';

// Runtime-adjustable settings via the web app -- previously only reachable
// by writing SQL directly against app_setting (still possible; this is a
// UI on top of the same table, not a new mechanism). admin already has
// SELECT/INSERT/UPDATE on app_setting from the Phase 3 RBAC migration, so
// unlike staff_account this needed no new grant.
export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireRole('admin'));

const SETTING_KEYS = ['FUZZY_MATCH_THRESHOLD', 'FUZZY_MATCH_BDATE_TOLERANCE_DAYS'] as const;

adminSettingsRouter.get('/', async (_req, res) => {
  const values = await Promise.all(SETTING_KEYS.map((key) => getSetting(key)));
  res.json(Object.fromEntries(SETTING_KEYS.map((key, i) => [key, values[i]])));
});

const updateSchema = z.object({
  key: z.enum(SETTING_KEYS),
  value: z.string().trim().min(1).max(50),
});

adminSettingsRouter.patch('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid setting payload', parsed.error.flatten());
    return;
  }
  const { key, value } = parsed.data;

  // Both current settings are numeric -- validated here rather than in the
  // zod schema (which only knows the two keys are strings) so a bad number
  // never reaches getFuzzyMatchThreshold()/getBdateToleranceDays() and
  // silently becomes NaN mid-resolvePerson().
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    sendError(res, 400, 'VALIDATION_ERROR', `"${value}" is not a valid number for ${key}`);
    return;
  }
  if (key === 'FUZZY_MATCH_THRESHOLD' && (numeric < 0 || numeric > 1)) {
    sendError(res, 400, 'VALIDATION_ERROR', 'FUZZY_MATCH_THRESHOLD must be between 0 and 1');
    return;
  }
  if (key === 'FUZZY_MATCH_BDATE_TOLERANCE_DAYS' && numeric < 0) {
    sendError(res, 400, 'VALIDATION_ERROR', 'FUZZY_MATCH_BDATE_TOLERANCE_DAYS cannot be negative');
    return;
  }

  await setSetting(key, value, req.session.userId);

  const client = getPrismaForRole('admin');
  await insertAuditLog(client, {
    tableName: 'app_setting',
    recordId: null,
    action: 'update',
    actorUserId: req.session.userId,
    actorRole: req.session.role,
    changedFields: { key, value },
  });

  res.json({ key, value });
});
