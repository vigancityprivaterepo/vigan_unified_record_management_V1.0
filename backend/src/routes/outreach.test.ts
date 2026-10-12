import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

// A "seniors not on the Senior Citizen list" rule on the seeded CSWD office,
// with three people aged 60+ and nobody registered yet.
describe('outreach on a "not yet served" list', () => {
  const app = createApp();
  let cswdId = '';
  let agriId = '';
  let seniorId = '';
  let ruleId = '';
  let cleanupId = '';

  beforeAll(async () => {
    const senior = await prisma.officeModule.findFirstOrThrow({ where: { slug: 'senior', office: { slug: 'cswd' } } });
    const death = await prisma.officeModule.findFirstOrThrow({ where: { slug: 'death' } });
    seniorId = senior.id;
    cswdId = senior.officeId;
    agriId = (await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } })).id;
    ruleId = (await prisma.programGapRule.create({ data: { name: 'Seniors not listed (test)', kind: 'missing', targetModuleId: seniorId, minAge: 60 } })).id;
    cleanupId = (await prisma.programGapRule.create({ data: { name: 'Deceased on senior list (test)', kind: 'conflict', targetModuleId: seniorId, sourceModuleIds: [death.id] } })).id;
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.programGapRule.deleteMany({ where: { id: { in: [ruleId, cleanupId] } } });
    await prisma.$disconnect();
  });

  async function seniors() {
    const make = (lname: string) => prisma.citizen.create({ data: { personLname: lname, personFname: 'Test', personBdate: new Date('1950-01-01'), personStreet: 'Purok 1' } });
    return { a: await make('Abad'), b: await make('Bello'), c: await make('Cruz') };
  }
  const base = () => `/offices/${cswdId}/program-gaps/${ruleId}`;

  it('marks results, filters by them and counts progress', async () => {
    const { a, b, c } = await seniors();
    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.put(`${base()}/people/${a.personKey}/outreach`).send({ status: 'reached', note: 'Coming Monday' })).status).toBe(200);
    expect((await staff.put(`${base()}/people/${b.personKey}/outreach`).send({ status: 'not_found' })).status).toBe(200);
    // Changing your mind replaces the result, it does not add a second one.
    expect((await staff.put(`${base()}/people/${b.personKey}/outreach`).send({ status: 'moved' })).status).toBe(200);

    const all = await staff.get(`${base()}/people`);
    expect(all.body.total).toBe(3);
    expect(all.body.items.find((p: { personKey: string }) => p.personKey === a.personKey)).toMatchObject({ street: 'Purok 1', outreach: { status: 'reached', note: 'Coming Monday' } });
    expect(all.body.items.find((p: { personKey: string }) => p.personKey === c.personKey).outreach).toBeNull();

    const todo = await staff.get(`${base()}/people`).query({ outreach: 'todo' });
    expect(todo.body.items.map((p: { personKey: string }) => p.personKey)).toEqual([c.personKey]);
    expect((await staff.get(`${base()}/people`).query({ outreach: 'done' })).body.total).toBe(2);
    expect((await staff.get(`${base()}/people`).query({ outreach: 'moved' })).body.total).toBe(1);

    const summary = await staff.get(`/offices/${cswdId}/program-gaps`);
    const rule = summary.body.rules.find((r: { id: string }) => r.id === ruleId);
    expect(rule).toMatchObject({ total: 3, outreach: { reached: 1, declined: 0, not_found: 0, moved: 1 } });
    expect(summary.body.rules.find((r: { id: string }) => r.id === cleanupId).outreach).toBeNull();

    const print = await staff.get(`${base()}/print`).query({ outreach: 'todo' });
    expect(print.body).toMatchObject({ truncated: false });
    expect(print.body.items).toHaveLength(1);
    const csv = await staff.get(`${base()}/people.csv`);
    expect(csv.text).toContain('Reached, will come in');
    expect(csv.text).toContain('Coming Monday');
  });

  it('a person who registers leaves the list and the progress count; a result can be cleared', async () => {
    const { a, b } = await seniors();
    const staff = await loginAgent(app, 'cswd.demo');
    await staff.put(`${base()}/people/${a.personKey}/outreach`).send({ status: 'reached' });
    await staff.put(`${base()}/people/${b.personKey}/outreach`).send({ status: 'declined' });

    await prisma.officeRecord.create({ data: { moduleId: seniorId, personKey: a.personKey, data: {} } });
    const summary = await staff.get(`/offices/${cswdId}/program-gaps`);
    expect(summary.body.rules.find((r: { id: string }) => r.id === ruleId)).toMatchObject({ total: 2, outreach: { reached: 0, declined: 1 } });
    // Already registered, so there is nobody to mark.
    expect((await staff.put(`${base()}/people/${a.personKey}/outreach`).send({ status: 'moved' })).status).toBe(404);

    expect((await staff.put(`${base()}/people/${b.personKey}/outreach`).send({ status: null })).status).toBe(200);
    expect((await staff.get(`${base()}/people`).query({ outreach: 'done' })).body.total).toBe(0);
  });

  it('refuses bad input, cleanup lists and other offices, and logs each result', async () => {
    const { a } = await seniors();
    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.put(`${base()}/people/${a.personKey}/outreach`).send({ status: 'texted' })).status).toBe(400);
    expect((await staff.put(`/offices/${cswdId}/program-gaps/${cleanupId}/people/${a.personKey}/outreach`).send({ status: 'reached' })).status).toBe(404);

    const other = await loginAgent(app, 'agri.demo');
    expect((await other.put(`${base()}/people/${a.personKey}/outreach`).send({ status: 'reached' })).status).toBe(403);
    expect((await other.put(`/offices/${agriId}/program-gaps/${ruleId}/people/${a.personKey}/outreach`).send({ status: 'reached' })).status).toBe(404);

    const admin = await loginAgent(app, 'admin.demo');
    expect((await admin.put(`/admin/program-gaps/${ruleId}/people/${a.personKey}/outreach`).send({ status: 'reached' })).status).toBe(200);
    const logged = await prisma.auditLog.findMany({ where: { tableName: 'outreach_contact' } });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.changedFields).toMatchObject({ ruleId, status: 'reached', personKeys: [a.personKey] });
  });
});
