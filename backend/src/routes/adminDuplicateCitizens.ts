import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { applyDeathsFor } from '../services/deathEffects';
import { duplicatePairs, markDistinct } from '../services/duplicateCitizens';
import { mergeCitizens } from '../services/mergeCitizens';

// Possible duplicates among the citizens already in the registry
// (services/duplicateCitizens.ts): list them, merge a pair, or say the two
// are different people. The Duplicate review page shows them under the
// queue of intakes waiting for a decision.
export const adminDuplicateCitizensRouter = Router();

adminDuplicateCitizensRouter.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  res.json(await duplicatePairs(getPrismaForRole('admin'), page));
}));

const pairSchema = z.object({ keepPersonKey: z.string().uuid(), otherPersonKey: z.string().uuid() }).refine((p) => p.keepPersonKey !== p.otherPersonKey);

// Same person: everything recorded under the other citizen moves to the one
// kept, and the other is archived (services/mergeCitizens.ts).
adminDuplicateCitizensRouter.post('/merge', requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = pairSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Choose two different citizens', parsed.error.flatten());
    return;
  }
  const { keepPersonKey, otherPersonKey } = parsed.data;
  const actorUserId = req.session.userId!;
  const client = getPrismaForRole('admin');

  const active = await client.citizen.count({ where: { personKey: { in: [keepPersonKey, otherPersonKey] }, isArchived: false } });
  if (active !== 2) {
    sendError(res, 404, 'NOT_FOUND', 'One of these citizens is no longer in the registry');
    return;
  }
  const mergeResult = await client.$transaction((tx) => mergeCitizens(tx, keepPersonKey, otherPersonKey, actorUserId));
  await applyDeathsFor(client, keepPersonKey, { userId: actorUserId, role: 'admin' });
  res.json({ status: 'merged', mergeResult });
}));

adminDuplicateCitizensRouter.post('/distinct', requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = pairSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Choose two different citizens', parsed.error.flatten());
    return;
  }
  const { keepPersonKey, otherPersonKey } = parsed.data;
  const actorUserId = req.session.userId!;
  const client = getPrismaForRole('admin');
  await markDistinct(client, keepPersonKey, otherPersonKey, actorUserId);
  await insertAuditLog(client, { tableName: 'Citizen', recordId: keepPersonKey, action: 'update', actorUserId, actorRole: 'admin', changedFields: { notTheSamePersonAs: otherPersonKey } });
  res.status(204).send();
}));
