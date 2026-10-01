import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actorUserId = '00000000-0000-0000-0000-000000000000';

// cswd.demo is scoped to the seeded CSWD office, so each test adds its own
// randomly-slugged module there (offices/modules aren't reset between tests).
async function seedCswdModule() {
  const office = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
  return prisma.officeModule.create({
    data: { officeId: office.id, name: 'Test Module', slug: `test_${Date.now()}_${Math.random().toString(36).slice(2)}` },
  });
}

describe('office records list statuses + CSV exports', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('tags linked / new / review rows, counts them, and filters by status', async () => {
    const officeModule = await seedCswdModule();
    const old = await prisma.citizen.create({
      data: { personLname: 'Older', personFname: 'Linked', personBdate: new Date('1970-01-01'), createdAt: new Date('2020-01-01') },
    });
    await prisma.officeRecord.create({ data: { moduleId: officeModule.id, personKey: old.personKey, data: {}, createdBy: actorUserId } });
    const fresh = await prisma.citizen.create({ data: { personLname: 'Fresh', personFname: 'New', personBdate: new Date('1990-01-01') } });
    await prisma.officeRecord.create({ data: { moduleId: officeModule.id, personKey: fresh.personKey, data: {}, createdBy: actorUserId } });
    await prisma.duplicateReviewQueueItem.create({
      data: {
        moduleId: officeModule.id,
        candidateData: { lname: 'Queued', fname: 'Person', bdate: '1985-05-05', fields: {} },
        fuzzyMatches: [],
        createdBy: actorUserId,
      },
    });

    const agent = await loginAgent(app, 'cswd.demo');
    const url = `/offices/${officeModule.officeId}/modules/${officeModule.id}/records`;

    const all = await agent.get(url);
    expect(all.status).toBe(200);
    expect(all.body.counts).toEqual({ all: 3, linked: 1, new: 1, unlinked: 0, review: 1, archived: 0 });
    expect(all.body.items.map((i: { status: string }) => i.status).sort()).toEqual(['linked', 'new', 'review']);

    const review = await agent.get(url).query({ status: 'review' });
    expect(review.body.total).toBe(1);
    expect(review.body.items[0].unresolvedPerson.lname).toBe('Queued');
    expect(review.body.items[0]).not.toHaveProperty('fuzzyMatches');
  });

  it("blocks another office's staff from the list and the export", async () => {
    const officeModule = await seedCswdModule();
    const agent = await loginAgent(app, 'agri.demo');
    const base = `/offices/${officeModule.officeId}/modules/${officeModule.id}/records`;
    expect((await agent.get(base)).status).toBe(403);
    expect((await agent.get(`${base}/export.csv`)).status).toBe(403);
  });

  it('exports module records as CSV and audit-logs the export', async () => {
    const officeModule = await seedCswdModule();
    const citizen = await prisma.citizen.create({ data: { personLname: '=cmd', personFname: 'Ana', personBdate: new Date('1990-01-01') } });
    await prisma.officeRecord.create({ data: { moduleId: officeModule.id, personKey: citizen.personKey, data: {}, createdBy: actorUserId } });

    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.get(`/offices/${officeModule.officeId}/modules/${officeModule.id}/records/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain("'=cmd,Ana");

    const log = await prisma.auditLog.findFirst({ where: { tableName: 'office_record', action: 'read' }, orderBy: { timestamp: 'desc' } });
    expect(log?.changedFields).toMatchObject({ event: 'export_csv', moduleId: officeModule.id, rowCount: 1 });
  });

  it('masterlist export: admin 200, office_staff 403, anonymous 401', async () => {
    await prisma.citizen.create({ data: { personLname: 'Master', personFname: 'List', personBdate: new Date('1960-01-01') } });
    const admin = await loginAgent(app, 'admin.demo');
    const res = await admin.get('/admin/citizens/export.csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Master,List');
    expect((await (await loginAgent(app, 'cswd.demo')).get('/admin/citizens/export.csv')).status).toBe(403);
    expect((await request(app).get('/admin/citizens/export.csv')).status).toBe(401);
  });

  it('login and /auth/me return the full name', async () => {
    const agent = await loginAgent(app, 'cswd.demo');
    const me = await agent.get('/auth/me');
    expect(me.body.fullName).toBe('CSWD Demo Staff');
  });
});
