import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { resetDb } from '../testUtils/resetDb';
import { mergeCitizens } from './mergeCitizens';

// actor_user_id / updated_by columns are uuid -- a valid-format actor id is
// required even though no real user row is seeded in these tests.
const actorUserId = randomUUID();

async function seedModule() {
  const office = await prisma.office.create({
    data: { name: 'Test Office', slug: `test_office_${randomUUID().slice(0, 8)}`, createdBy: actorUserId },
  });
  const officeModule = await prisma.officeModule.create({
    data: { officeId: office.id, name: 'Test Module', slug: 'default' },
  });
  return officeModule;
}

describe('mergeCitizens', () => {
  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reassigns every office record and household reference from losing to winning, and archives the loser', async () => {
    const officeModule = await seedModule();

    const winning = await prisma.citizen.create({
      data: { personLname: 'Cruz', personFname: 'Elena', personBdate: new Date('1970-01-01') },
    });
    const losing = await prisma.citizen.create({
      data: { personLname: 'Cruz', personFname: 'Elena', personBdate: new Date('1970-01-01') },
    });

    // Two records under the losing citizen -- the fixture from Phase 2's
    // "Birth record A has a PWD record, Birth record B has a Senior record"
    // case, now that both live in the same office_record table.
    await prisma.officeRecord.create({
      data: { moduleId: officeModule.id, personKey: losing.personKey, data: {}, createdBy: actorUserId, updatedBy: actorUserId },
    });
    await prisma.officeRecord.create({
      data: { moduleId: officeModule.id, personKey: losing.personKey, data: {}, createdBy: actorUserId, updatedBy: actorUserId },
    });
    const child = await prisma.citizen.create({
      data: {
        personLname: 'Cruz',
        personFname: 'Nico',
        personBdate: new Date('2000-01-01'),
        personParentKey: losing.personKey,
      },
    });

    const result = await prisma.$transaction((tx) => mergeCitizens(tx, winning.personKey, losing.personKey, actorUserId));

    expect(result.reassigned).toMatchObject({
      OfficeRecord: 2,
      CitizenParentRef: 1,
      CitizenSubParentRef: 0,
    });

    const [records, refreshedChild, refreshedLoser] = await Promise.all([
      prisma.officeRecord.findMany({ where: { personKey: winning.personKey } }),
      prisma.citizen.findUnique({ where: { personKey: child.personKey } }),
      prisma.citizen.findUnique({ where: { personKey: losing.personKey } }),
    ]);

    expect(records).toHaveLength(2);
    expect(refreshedChild?.personParentKey).toBe(winning.personKey);

    // Never hard-deleted -- archived only (losing row still owns audit history).
    expect(refreshedLoser).not.toBeNull();
    expect(refreshedLoser?.isArchived).toBe(true);

    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'merge', recordId: winning.personKey } });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.changedFields).toMatchObject({
      winningKey: winning.personKey,
      losingKey: losing.personKey,
    });
  });

  it('rejects a merge where either citizen does not exist', async () => {
    const existing = await prisma.citizen.create({
      data: { personLname: 'X', personFname: 'Y', personBdate: new Date('2000-01-01') },
    });

    await expect(
      prisma.$transaction((tx) =>
        mergeCitizens(tx, existing.personKey, '00000000-0000-0000-0000-000000000000', actorUserId),
      ),
    ).rejects.toThrow();
  });
});
