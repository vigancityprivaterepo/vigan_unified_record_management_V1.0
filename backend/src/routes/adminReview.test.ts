import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { authPrisma } from '../lib/authPrisma';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

describe('/admin/duplicate-review-queue', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await authPrisma.$disconnect();
    await prisma.$disconnect();
  });

  async function seedModule() {
    const office = await prisma.office.create({
      data: { name: 'Test Office', slug: `test_office_${randomUUID().slice(0, 8)}`, createdBy: randomUUID() },
    });
    return prisma.officeModule.create({ data: { officeId: office.id, name: 'Test Module', slug: 'default' } });
  }

  async function seedPendingQueueItem() {
    const existing = await prisma.citizen.create({
      data: { personLname: 'Fernandez', personFname: 'Rosario', personBdate: new Date('1960-03-15') },
    });
    const officeModule = await seedModule();
    const item = await prisma.duplicateReviewQueueItem.create({
      data: {
        moduleId: officeModule.id,
        candidateData: {
          lname: 'Fernandez',
          fname: 'Rosario',
          bdate: '1960-03-15T00:00:00.000Z',
          fields: { commorbidity: 'Diabetes', hasId: true },
        },
        fuzzyMatches: [
          { personKey: existing.personKey, personLname: 'Fernandez', personFname: 'Rosario', similarity: 1 },
        ],
        createdBy: randomUUID(),
      },
    });
    return { existing, item, officeModule };
  }

  it('rejects non-admin roles', async () => {
    const agent = await loginAgent(app, 'cswd.demo');
    const listRes = await agent.get('/admin/duplicate-review-queue');
    expect(listRes.status).toBe(403);
  });

  it('lists only pending items', async () => {
    const { item } = await seedPendingQueueItem();
    const officeModule = await seedModule();
    await prisma.duplicateReviewQueueItem.create({
      data: {
        moduleId: officeModule.id,
        candidateData: { lname: 'X', fname: 'Y', bdate: '2000-01-01T00:00:00.000Z' },
        fuzzyMatches: [],
        status: 'approved',
        createdBy: randomUUID(),
      },
    });

    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/duplicate-review-queue');
    expect(res.status).toBe(200);
    expect(res.body.map((i: { id: string }) => i.id)).toEqual([item.id]);
  });

  it('approve: reassigns the office record to the winner and archives the losing (newly materialized) Citizen', async () => {
    const { existing, item, officeModule } = await seedPendingQueueItem();
    const agent = await loginAgent(app, 'admin.demo');

    const res = await agent
      .post(`/admin/duplicate-review-queue/${item.id}/approve`)
      .send({ winningPersonKey: existing.personKey });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.mergeResult.winningKey).toBe(existing.personKey);

    // The office record created for the queued intake now points at the
    // winner, not at the (now-archived) citizen materialized from the queue.
    const officeRecords = await prisma.officeRecord.findMany({ where: { personKey: existing.personKey, moduleId: officeModule.id } });
    expect(officeRecords).toHaveLength(1);
    expect((officeRecords[0]?.data as { commorbidity?: string })?.commorbidity).toBe('Diabetes');

    const losingKey = res.body.mergeResult.losingKey;
    const losingCitizen = await prisma.citizen.findUnique({ where: { personKey: losingKey } });
    expect(losingCitizen?.isArchived).toBe(true);

    const queueItem = await prisma.duplicateReviewQueueItem.findUnique({ where: { id: item.id } });
    expect(queueItem?.status).toBe('approved');
    expect(queueItem?.reviewedBy).toBeTruthy();
    expect(queueItem?.resolvedPersonKey).toBe(existing.personKey);

    // Reviewer attribution in audit_log for the decision itself.
    const decisionAudit = await prisma.auditLog.findFirst({
      where: { tableName: 'duplicate_review_queue_item', recordId: item.id, action: 'update' },
    });
    expect(decisionAudit?.actorRole).toBe('admin');
    expect(decisionAudit?.changedFields).toMatchObject({ decision: 'approved', winningPersonKey: existing.personKey });

    // The merge itself is audit-logged too.
    const mergeAudit = await prisma.auditLog.findFirst({
      where: { tableName: 'Citizen', recordId: existing.personKey, action: 'merge' },
    });
    expect(mergeAudit).not.toBeNull();
  });

  it('reject: creates a new, distinct Citizen row and clears the queue item', async () => {
    const { existing, item } = await seedPendingQueueItem();
    const agent = await loginAgent(app, 'admin.demo');

    const res = await agent.post(`/admin/duplicate-review-queue/${item.id}/reject`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.personKey).not.toBe(existing.personKey);

    const newCitizen = await prisma.citizen.findUnique({ where: { personKey: res.body.personKey } });
    expect(newCitizen?.personLname).toBe('Fernandez');
    expect(newCitizen?.isArchived).toBe(false);

    // The original candidate is untouched -- rejection doesn't merge or archive it.
    const originalCitizen = await prisma.citizen.findUnique({ where: { personKey: existing.personKey } });
    expect(originalCitizen?.isArchived).toBe(false);

    const queueItem = await prisma.duplicateReviewQueueItem.findUnique({ where: { id: item.id } });
    expect(queueItem?.status).toBe('rejected');
    expect(queueItem?.resolvedPersonKey).toBe(res.body.personKey);

    // Cleared from the pending list.
    const listRes = await agent.get('/admin/duplicate-review-queue');
    expect(listRes.body.map((i: { id: string }) => i.id)).not.toContain(item.id);

    const decisionAudit = await prisma.auditLog.findFirst({
      where: { tableName: 'duplicate_review_queue_item', recordId: item.id, action: 'update' },
    });
    expect(decisionAudit?.actorRole).toBe('admin');
    expect(decisionAudit?.changedFields).toMatchObject({ decision: 'rejected' });
  });

  it('returns 404 for an already-resolved item', async () => {
    const { existing, item } = await seedPendingQueueItem();
    const agent = await loginAgent(app, 'admin.demo');

    await agent.post(`/admin/duplicate-review-queue/${item.id}/reject`).send({});
    const secondAttempt = await agent
      .post(`/admin/duplicate-review-queue/${item.id}/approve`)
      .send({ winningPersonKey: existing.personKey });

    expect(secondAttempt.status).toBe(404);
  });
});
