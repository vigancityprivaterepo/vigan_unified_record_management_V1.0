import type { Prisma } from '@prisma/client';
import { insertAuditLog } from '../lib/auditLog';

export type MergeResult = {
  winningKey: string;
  losingKey: string;
  reassigned: Record<string, number>;
};

// Confirms "same person" for two Citizen rows that may each already have
// their own satellite data. Reassigns every satellite FK (and any household
// person_parent_key/person_sub_parent_key references) from the losing key
// to the winning key, archives the losing row (never hard-deletes -- it may
// own Birth/Death records under RA 9470 retention), and logs the merge with
// both original keys.
//
// Takes an already-open transaction client rather than opening its own --
// the admin duplicate-review approve flow (adminReview.ts) needs this to run
// in the same transaction as materializing the queued intake and updating
// the queue item, so a crash partway through can't orphan a record or leave
// the queue item stuck. Standalone callers (tests) open their own
// `prisma.$transaction()` and pass the `tx` in.
export async function mergeCitizens(
  tx: Prisma.TransactionClient,
  winningKey: string,
  losingKey: string,
  actorUserId: string,
): Promise<MergeResult> {
  if (winningKey === losingKey) {
    throw new Error('mergeCitizens: winningKey and losingKey must differ');
  }

  const [winner, loser] = await Promise.all([
    tx.citizen.findUnique({ where: { personKey: winningKey } }),
    tx.citizen.findUnique({ where: { personKey: losingKey } }),
  ]);
  if (!winner) throw new Error(`mergeCitizens: winning citizen ${winningKey} not found`);
  if (!loser) throw new Error(`mergeCitizens: losing citizen ${losingKey} not found`);

  const reassigned: Record<string, number> = {};

  // Every office's records now live in one table, keyed by person_key --
  // no more per-office satellite tables to loop over individually.
  const records = await tx.officeRecord.updateMany({
    where: { personKey: losingKey },
    data: { personKey: winningKey },
  });
  reassigned.OfficeRecord = records.count;

  // Household references: anyone pointing at the losing row as their
  // household head/sub-head needs to follow the merge too.
  const parentRefs = await tx.citizen.updateMany({
    where: { personParentKey: losingKey },
    data: { personParentKey: winningKey },
  });
  reassigned.CitizenParentRef = parentRefs.count;

  const subParentRefs = await tx.citizen.updateMany({
    where: { personSubParentKey: losingKey },
    data: { personSubParentKey: winningKey },
  });
  reassigned.CitizenSubParentRef = subParentRefs.count;

  await tx.citizen.update({
    where: { personKey: losingKey },
    data: { isArchived: true, updatedBy: actorUserId },
    select: { personKey: true },
  });

  await insertAuditLog(tx, {
    tableName: 'Citizen',
    recordId: winningKey,
    action: 'merge',
    actorUserId,
    actorRole: 'admin',
    changedFields: { winningKey, losingKey, reassigned },
  });

  return { winningKey, losingKey, reassigned };
}
