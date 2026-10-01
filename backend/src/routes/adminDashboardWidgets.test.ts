import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actorUserId = '00000000-0000-0000-0000-000000000000';

async function seedModule(slug: string) {
  const office = await prisma.office.create({
    data: { name: 'Test Office', slug: `${slug}_${Date.now()}_${Math.random().toString(36).slice(2)}`, createdBy: actorUserId },
  });
  return prisma.officeModule.create({ data: { officeId: office.id, name: 'Test Module', slug: 'default' } });
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

async function seedRecord(moduleId: string, personKey: string | null, createdAt?: Date) {
  return prisma.officeRecord.create({
    data: { moduleId, personKey, data: {}, createdBy: actorUserId, updatedBy: actorUserId, ...(createdAt ? { createdAt } : {}) },
  });
}

function ageBracketFor(years: number): string {
  const start = Math.floor(years / 10) * 10;
  return `${start}-${start + 9}`;
}

function birthdateForAge(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

describe('/admin/dashboard/widgets (age_bracket + filters)', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('age_bracket groups citizens into 10-year bands', async () => {
    const senior = await seedModule('senior');
    const p25 = await seedCitizen({ personBdate: birthdateForAge(25) });
    const p35 = await seedCitizen({ personBdate: birthdateForAge(35) });
    await seedRecord(senior.id, p25.personKey);
    await seedRecord(senior.id, p35.personKey);

    const agent = await loginAgent(app, 'admin.demo');
    const createRes = await agent.post('/admin/dashboard/widgets').send({
      title: 'Age test',
      sourceModuleIds: [senior.id],
      groupBy: ['age_bracket'],
      chartType: 'bar',
    });
    expect(createRes.status).toBe(201);

    const dataRes = await agent.get(`/admin/dashboard/widgets/${createRes.body.id}/data`);
    expect(dataRes.status).toBe(200);
    const labels = dataRes.body.map((r: { label: string }) => r.label).sort();
    expect(labels).toEqual([ageBracketFor(25), ageBracketFor(35)].sort());
  });

  it('a barangay filter narrows a number widget to matching citizens only', async () => {
    const senior = await seedModule('senior');
    const a = await prisma.barangay.upsert({ where: { code: 'TSTFLTA' }, create: { code: 'TSTFLTA', name: 'Filter A' }, update: {} });
    const b = await prisma.barangay.upsert({ where: { code: 'TSTFLTB' }, create: { code: 'TSTFLTB', name: 'Filter B' }, update: {} });
    const inA = await seedCitizen({ personBrgyCode: a.code });
    const inB = await seedCitizen({ personBrgyCode: b.code });
    await seedRecord(senior.id, inA.personKey);
    await seedRecord(senior.id, inB.personKey);

    const agent = await loginAgent(app, 'admin.demo');

    const unfiltered = await agent.post('/admin/dashboard/widgets').send({
      title: 'Unfiltered',
      sourceModuleIds: [senior.id],
      chartType: 'number',
    });
    const unfilteredData = await agent.get(`/admin/dashboard/widgets/${unfiltered.body.id}/data`);
    expect(unfilteredData.body[0].counts[0]).toBe(2);

    const filtered = await agent.post('/admin/dashboard/widgets').send({
      title: 'Filtered to A',
      sourceModuleIds: [senior.id],
      chartType: 'number',
      filterBarangayCode: a.code,
    });
    expect(filtered.status).toBe(201);
    expect(filtered.body.filterBarangayName).toBe('Filter A');

    const filteredData = await agent.get(`/admin/dashboard/widgets/${filtered.body.id}/data`);
    expect(filteredData.body[0].counts[0]).toBe(1);
  });

  it('a month filter narrows a number widget to that month only', async () => {
    const birth = await seedModule('birth');
    const citizen = await seedCitizen();
    await seedRecord(birth.id, citizen.personKey, new Date('2026-01-15T00:00:00.000Z'));
    await seedRecord(birth.id, citizen.personKey, new Date('2026-02-15T00:00:00.000Z'));

    const agent = await loginAgent(app, 'admin.demo');
    const widget = await agent.post('/admin/dashboard/widgets').send({
      title: 'Jan only',
      sourceModuleIds: [birth.id],
      chartType: 'number',
      filterMonth: '2026-01',
    });
    expect(widget.status).toBe(201);

    const data = await agent.get(`/admin/dashboard/widgets/${widget.body.id}/data`);
    expect(data.body[0].counts[0]).toBe(1);
  });

  it('rejects an unknown barangay filter', async () => {
    const senior = await seedModule('senior');
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/dashboard/widgets').send({
      title: 'Bad barangay',
      sourceModuleIds: [senior.id],
      chartType: 'number',
      filterBarangayCode: 'NOPE',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed month filter', async () => {
    const senior = await seedModule('senior');
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/dashboard/widgets').send({
      title: 'Bad month',
      sourceModuleIds: [senior.id],
      chartType: 'number',
      filterMonth: 'January 2026',
    });
    expect(res.status).toBe(400);
  });

  it('PATCH edits a widget\'s recipe -- title, sources, groupBy, and filters all replace, not merge', async () => {
    const senior = await seedModule('senior');
    const farmer = await seedModule('farmer');
    const a = await prisma.barangay.upsert({ where: { code: 'TSTEDTA' }, create: { code: 'TSTEDTA', name: 'Edit A' }, update: {} });

    const agent = await loginAgent(app, 'admin.demo');
    const created = await agent.post('/admin/dashboard/widgets').send({
      title: 'Original title',
      sourceModuleIds: [senior.id],
      chartType: 'bar',
      groupBy: ['sex'],
    });
    expect(created.status).toBe(201);

    const updated = await agent.patch(`/admin/dashboard/widgets/${created.body.id}`).send({
      title: 'Updated title',
      sourceModuleIds: [farmer.id],
      chartType: 'bar',
      groupBy: ['barangay'],
      filterBarangayCode: a.code,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('Updated title');
    expect(updated.body.groupBy).toEqual(['barangay']);
    expect(updated.body.filterBarangayName).toBe('Edit A');
    expect(updated.body.sourceModules.map((m: { id: string }) => m.id)).toEqual([farmer.id]);

    // Refetching confirms the old source (senior) was actually replaced,
    // not appended to.
    const list = await agent.get('/admin/dashboard/widgets');
    const widget = list.body.find((w: { id: string }) => w.id === created.body.id);
    expect(widget.sourceModules).toHaveLength(1);
    expect(widget.sourceModules[0].id).toBe(farmer.id);
  });

  it('PATCH 404s for an unknown widget id', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.patch('/admin/dashboard/widgets/00000000-0000-0000-0000-000000000000').send({
      title: 'Nope',
      sourceModuleIds: [],
      chartType: 'number',
    });
    expect(res.status).toBe(404);
  });

  it('saves a donut widget and toggles it on/off the dashboard', async () => {
    const senior = await seedModule('senior');
    const agent = await loginAgent(app, 'admin.demo');
    const created = await agent.post('/admin/dashboard/widgets').send({
      title: 'Seniors by sex',
      sourceModuleIds: [senior.id],
      groupBy: ['sex'],
      chartType: 'donut',
    });
    expect(created.status).toBe(201);
    expect(created.body.chartType).toBe('donut');
    expect(created.body.showOnDashboard).toBe(true);

    const off = await agent.patch(`/admin/dashboard/widgets/${created.body.id}/dashboard`).send({ showOnDashboard: false });
    expect(off.status).toBe(200);
    expect(off.body.showOnDashboard).toBe(false);

    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.patch(`/admin/dashboard/widgets/${created.body.id}/dashboard`).send({ showOnDashboard: true })).status).toBe(403);
  });
});
