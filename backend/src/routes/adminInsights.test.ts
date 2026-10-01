import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actorUserId = '00000000-0000-0000-0000-000000000000';

// Office slug is randomized (Office.slug is globally unique); module slug
// is exactly what the test asks for, since insights.ts keys off module
// slug to exclude Birth/Death -- unlike adminDashboard.test.ts's
// seedModule(), which always hardcodes 'default' since it never needed a
// specific slug.
async function seedModule(moduleSlug: string, moduleName = moduleSlug) {
  const office = await prisma.office.create({
    data: { name: 'Test Office', slug: `test_office_${Date.now()}_${Math.random().toString(36).slice(2)}`, createdBy: actorUserId },
  });
  return prisma.officeModule.create({
    data: { officeId: office.id, name: moduleName, slug: moduleSlug },
  });
}

async function seedCitizen(overrides: Partial<Parameters<typeof prisma.citizen.create>[0]['data']> = {}) {
  return prisma.citizen.create({
    data: {
      personLname: 'Test',
      personFname: `Person-${Math.random().toString(36).slice(2)}`,
      personBdate: new Date('1980-01-01'),
      ...overrides,
    },
  });
}

async function seedRecord(moduleId: string, personKey: string, createdAt?: Date) {
  return prisma.officeRecord.create({
    data: { moduleId, personKey, data: {}, createdBy: actorUserId, updatedBy: actorUserId, ...(createdAt ? { createdAt } : {}) },
  });
}

describe('/admin/insights', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects non-admin roles', async () => {
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.get('/admin/insights/summary');
    expect(res.status).toBe(403);
  });

  it('office-breakdown: admin 200, office_staff 403, anonymous 401', async () => {
    const admin = await loginAgent(app, 'admin.demo');
    expect((await admin.get('/admin/insights/office-breakdown')).status).toBe(200);
    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.get('/admin/insights/office-breakdown')).status).toBe(403);
    expect((await request(app).get('/admin/insights/office-breakdown')).status).toBe(401);
  });

  describe('sankey + overlap count', () => {
    it('buckets people by their membership-module set and excludes birth/death', async () => {
      const senior = await seedModule('senior', 'Senior Citizen');
      const farmer = await seedModule('farmer', 'Farmer');
      const birth = await seedModule('birth', 'Birth');

      const seniorFarmer = await seedCitizen();
      await seedRecord(senior.id, seniorFarmer.personKey);
      await seedRecord(farmer.id, seniorFarmer.personKey);

      const seniorOnly = await seedCitizen();
      await seedRecord(senior.id, seniorOnly.personKey);

      // Birth-only: has an office_record, but under an excluded module --
      // must not appear as its own bucket or inflate any other bucket.
      const birthOnly = await seedCitizen();
      await seedRecord(birth.id, birthOnly.personKey);

      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.get('/admin/insights/sankey');
      expect(res.status).toBe(200);

      const moduleSlugs = res.body.modules.map((m: { slug: string }) => m.slug);
      expect(moduleSlugs).toContain('senior');
      expect(moduleSlugs).toContain('farmer');
      expect(moduleSlugs).not.toContain('birth');

      const buckets: Array<{ label: string; count: number }> = res.body.buckets;
      const seniorFarmerBucket = buckets.find((b) => b.label === 'Senior Citizen + Farmer');
      const seniorOnlyBucket = buckets.find((b) => b.label === 'Senior Citizen');
      expect(seniorFarmerBucket?.count).toBe(1);
      expect(seniorOnlyBucket?.count).toBe(1);
      // birthOnly contributes to no bucket at all (no membership-module record).
      expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(2);

      const summaryRes = await agent.get('/admin/insights/summary');
      expect(summaryRes.body.overlapCount).toBe(1); // only seniorFarmer holds 2+ membership modules
    });

    it('filters the drill-down list to an exact bucket match', async () => {
      const senior = await seedModule('senior');
      const farmer = await seedModule('farmer');

      const seniorFarmer = await seedCitizen({ personLname: 'Bucket', personFname: 'Match' });
      await seedRecord(senior.id, seniorFarmer.personKey);
      await seedRecord(farmer.id, seniorFarmer.personKey);

      const seniorOnly = await seedCitizen({ personLname: 'Bucket', personFname: 'NoMatch' });
      await seedRecord(senior.id, seniorOnly.personKey);

      const agent = await loginAgent(app, 'admin.demo');
      const bucket = [senior.id, farmer.id].sort().join(',');
      const res = await agent.get('/admin/insights/citizens').query({ bucket });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].personKey).toBe(seniorFarmer.personKey);
    });
  });

  describe('completeness %', () => {
    it('counts a citizen complete only when every core field is filled', async () => {
      const barangay = await prisma.barangay.upsert({
        where: { code: 'TSTCMPLT' },
        create: { code: 'TSTCMPLT', name: 'Test Complete Barangay' },
        update: {},
      });
      await seedCitizen({
        personBrgyCode: barangay.code,
        personSex: 'F',
        personCivilStatus: 'Single',
        personOccupation: 'Farmer',
        personBdate: new Date('1990-01-01'),
      });
      await seedCitizen({ personBrgyCode: null, personSex: null, personCivilStatus: null, personOccupation: null });

      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.get('/admin/insights/summary');

      expect(res.status).toBe(200);
      expect(res.body.completenessPct).toBe(50);
    });
  });

  describe('barangay ranking', () => {
    it('ranks barangays by resident citizen count, descending', async () => {
      const a = await prisma.barangay.upsert({ where: { code: 'TSTRANKA' }, create: { code: 'TSTRANKA', name: 'Rank A' }, update: {} });
      const b = await prisma.barangay.upsert({ where: { code: 'TSTRANKB' }, create: { code: 'TSTRANKB', name: 'Rank B' }, update: {} });
      await seedCitizen({ personBrgyCode: a.code });
      await seedCitizen({ personBrgyCode: a.code });
      await seedCitizen({ personBrgyCode: b.code });

      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.get('/admin/insights/barangay-ranking');

      expect(res.status).toBe(200);
      const rankA = res.body.find((r: { code: string }) => r.code === a.code);
      const rankB = res.body.find((r: { code: string }) => r.code === b.code);
      expect(rankA.count).toBe(2);
      expect(rankB.count).toBe(1);
      expect(res.body.indexOf(rankA)).toBeLessThan(res.body.indexOf(rankB));
    });
  });

  describe('trend', () => {
    it('reports monthly registrations (all modules) and approved merges separately', async () => {
      const birth = await seedModule('birth');
      const citizen = await seedCitizen();
      await seedRecord(birth.id, citizen.personKey, new Date('2026-01-15T00:00:00.000Z'));
      await seedRecord(birth.id, citizen.personKey, new Date('2026-02-15T00:00:00.000Z'));

      await prisma.duplicateReviewQueueItem.create({
        data: {
          moduleId: birth.id,
          candidateData: {},
          fuzzyMatches: {},
          status: 'approved',
          createdBy: actorUserId,
          reviewedAt: new Date('2026-01-20T00:00:00.000Z'),
        },
      });

      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.get('/admin/insights/trend');

      expect(res.status).toBe(200);
      const jan = res.body.find((p: { month: string }) => p.month === '2026-01');
      const feb = res.body.find((p: { month: string }) => p.month === '2026-02');
      expect(jan).toEqual({ month: '2026-01', registrations: 1, merges: 1 });
      expect(feb).toEqual({ month: '2026-02', registrations: 1, merges: 0 });
    });
  });

  describe('household detail categories (via extended /admin/households/:headPersonKey)', () => {
    it('tags each member with every module touching them, including birth/death', async () => {
      const senior = await seedModule('senior', 'Senior');
      const birth = await seedModule('birth', 'Birth');

      const head = await seedCitizen({ personLname: 'Household', personFname: 'Head', personIsHead: true });
      await seedRecord(senior.id, head.personKey);
      await seedRecord(birth.id, head.personKey);

      const child = await seedCitizen({ personLname: 'Household', personFname: 'Child', personParentKey: head.personKey });

      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.get(`/admin/households/${head.personKey}`);

      expect(res.status).toBe(200);
      const headCategorySlugs = res.body.head.categories.map((c: { moduleName: string }) => c.moduleName).sort();
      expect(headCategorySlugs).toEqual(['Birth', 'Senior'].sort());

      const childRow = res.body.members.find((m: { personKey: string }) => m.personKey === child.personKey);
      expect(childRow.categories).toEqual([]);
    });
  });
});
