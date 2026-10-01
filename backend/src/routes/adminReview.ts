import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { mergeCitizens } from '../services/mergeCitizens';
import { createOfficeRecord } from '../services/officeSatelliteWriters';

export const adminReviewRouter = Router();

// No Prisma relation from queue item -> module (moduleId has no DB-level
// FK, unlike office_record/office_form_field's module_id) -- resolved here
// with a second query instead, so the list can still show which office/
// module each queued intake was headed for.
adminReviewRouter.get('/', requireRole('admin'), async (req, res) => {
  const client = getPrismaForRole('admin');
  const items = await client.duplicateReviewQueueItem.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });

  const moduleIds = [...new Set(items.map((i) => i.moduleId))];
  const modules = await client.officeModule.findMany({
    where: { id: { in: moduleIds } },
    select: { id: true, name: true, office: { select: { name: true } } },
  });
  const moduleById = new Map(modules.map((m) => [m.id, m]));

  res.json(
    items.map((item) => ({
      ...item,
      moduleName: moduleById.get(item.moduleId)?.name ?? null,
      officeName: moduleById.get(item.moduleId)?.office.name ?? null,
    })),
  );
});

type IntakeCandidate = {
  lname: string;
  fname: string;
  mname?: string;
  bdate: string;
  [key: string]: unknown;
};

function parseCandidate(raw: unknown): IntakeCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.lname !== 'string' || typeof c.fname !== 'string' || typeof c.bdate !== 'string') return null;
  return c as IntakeCandidate;
}

// Re-creates the queued intake as its own Citizen + satellite record (the
// same path resolvePerson()'s "no match" branch takes), then hands off to
// the caller -- approve merges it into the chosen winner, reject leaves it
// standing as the new, distinct record.
//
// Takes an already-open transaction client -- the caller (approve/reject
// below) owns the outer transaction so materializing, merging, and updating
// the queue item all commit or fail together. A crash partway through used
// to be able to leave an orphaned, never-merged Citizen row, or a merge that
// succeeded while the queue item stayed stuck "pending" forever.
async function materializeQueuedIntake(
  tx: Prisma.TransactionClient,
  item: { moduleId: string; candidateData: unknown },
  actorUserId: string,
): Promise<{ personKey: string }> {
  const candidate = parseCandidate(item.candidateData);
  if (!candidate) {
    throw new Error('materializeQueuedIntake: malformed candidate_data on queue item');
  }

  const citizen = await tx.citizen.create({
    data: {
      personLname: candidate.lname.trim(),
      personFname: candidate.fname.trim(),
      personMname: candidate.mname?.trim() || null,
      personBdate: new Date(candidate.bdate),
      createdBy: actorUserId,
      updatedBy: actorUserId,
    },
  });
  await insertAuditLog(tx, {
    tableName: 'Citizen',
    recordId: citizen.personKey,
    action: 'insert',
    actorUserId,
    actorRole: 'admin',
    changedFields: { source: 'duplicate_review_queue' },
  });

  const satellite = await createOfficeRecord(
    tx,
    item.moduleId,
    citizen.personKey,
    null,
    (candidate.fields as Record<string, unknown> | undefined) ?? {},
    actorUserId,
  );
  await insertAuditLog(tx, {
    tableName: satellite.table,
    recordId: satellite.recordId,
    action: 'insert',
    actorUserId,
    actorRole: 'admin',
  });

  return { personKey: citizen.personKey };
}

const approveSchema = z.object({ winningPersonKey: z.string().uuid() });

// Confirms the queued intake IS one of the flagged candidates. Materializes
// it as a normal Citizen + satellite record, then immediately merges that
// (now-redundant) record into the chosen winner via mergeCitizens() -- same
// FK reassignment + archive-the-loser + audit-logged-merge path as any
// other merge, just triggered from the review queue instead of a manual
// Citizen-360 comparison.
adminReviewRouter.post('/:id/approve', requireRole('admin'), async (req, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid approve payload', parsed.error.flatten());
    return;
  }
  const actorUserId = req.session.userId!;
  const client = getPrismaForRole('admin');

  try {
    const item = await client.duplicateReviewQueueItem.findUnique({ where: { id: req.params.id } });
    if (!item || item.status !== 'pending') {
      sendError(res, 404, 'NOT_FOUND', 'No pending review item with that id');
      return;
    }

    // Materialize + merge + queue-item update all commit together -- see
    // materializeQueuedIntake's comment for why this must be one transaction.
    const mergeResult = await client.$transaction(async (tx) => {
      const { personKey: losingKey } = await materializeQueuedIntake(tx, item, actorUserId);
      const result = await mergeCitizens(tx, parsed.data.winningPersonKey, losingKey, actorUserId);

      await tx.duplicateReviewQueueItem.update({
        where: { id: item.id },
        data: {
          status: 'approved',
          reviewedBy: actorUserId,
          reviewedAt: new Date(),
          resolvedPersonKey: parsed.data.winningPersonKey,
        },
        select: { id: true },
      });
      await insertAuditLog(tx, {
        tableName: 'duplicate_review_queue_item',
        recordId: item.id,
        action: 'update',
        actorUserId,
        actorRole: 'admin',
        changedFields: { decision: 'approved', winningPersonKey: parsed.data.winningPersonKey },
      });

      return result;
    });

    res.json({ status: 'approved', winningPersonKey: parsed.data.winningPersonKey, mergeResult });
  } catch (err) {
    console.error(err);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to approve review item');
  }
});

// Confirms none of the flagged candidates are the same person. Materializes
// the queued intake as its own new, distinct Citizen + satellite record and
// clears the queue item (marked 'rejected' -- filtered out of the pending
// list, never hard-deleted, so the decision stays in the audit trail).
adminReviewRouter.post('/:id/reject', requireRole('admin'), async (req, res) => {
  const actorUserId = req.session.userId!;
  const client = getPrismaForRole('admin');

  try {
    const item = await client.duplicateReviewQueueItem.findUnique({ where: { id: req.params.id } });
    if (!item || item.status !== 'pending') {
      sendError(res, 404, 'NOT_FOUND', 'No pending review item with that id');
      return;
    }

    const { personKey } = await client.$transaction(async (tx) => {
      const materialized = await materializeQueuedIntake(tx, item, actorUserId);

      await tx.duplicateReviewQueueItem.update({
        where: { id: item.id },
        data: {
          status: 'rejected',
          reviewedBy: actorUserId,
          reviewedAt: new Date(),
          resolvedPersonKey: materialized.personKey,
        },
        select: { id: true },
      });
      await insertAuditLog(tx, {
        tableName: 'duplicate_review_queue_item',
        recordId: item.id,
        action: 'update',
        actorUserId,
        actorRole: 'admin',
        changedFields: { decision: 'rejected', newPersonKey: materialized.personKey },
      });

      return materialized;
    });

    res.json({ status: 'rejected', personKey });
  } catch (err) {
    console.error(err);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to reject review item');
  }
});
