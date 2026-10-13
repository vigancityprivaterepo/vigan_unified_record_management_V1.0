import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actor = '00000000-0000-0000-0000-000000000000';

// Two programs of a test office are counted as assistance: Cash Aid records
// an amount, Food Packs does not.
describe('assistance across offices', () => {
  const app = createApp();
  let officeId = '';
  let cashId = '';
  let packsId = '';
  let brgy = '';

  beforeAll(async () => {
    const office = await prisma.office.create({ data: { name: 'Assistance Test Office', slug: `assistance_test_${Date.now()}` } });
    officeId = office.id;
    cashId = (await prisma.officeModule.create({ data: { officeId, name: 'Cash Aid (test)', slug: 'cash_aid', givesAssistance: true, assistanceAmountKey: 'amount_php' } })).id;
    packsId = (await prisma.officeModule.create({ data: { officeId, name: 'Food Packs (test)', slug: 'food_packs', givesAssistance: true } })).id;
    await prisma.officeFormField.create({ data: { moduleId: cashId, key: 'amount_php', label: 'Amount (PHP)', fieldType: 'NUMBER' } });
    await prisma.officeFormField.create({ data: { moduleId: cashId, key: 'purpose', label: 'Purpose', fieldType: 'TEXT' } });
    brgy = (await prisma.barangay.findFirstOrThrow({ orderBy: { code: 'asc' } })).code;
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.officeRecord.deleteMany({ where: { moduleId: { in: [cashId, packsId] } } });
    await prisma.officeFormField.deleteMany({ where: { moduleId: { in: [cashId, packsId] } } });
    await prisma.officeModule.deleteMany({ where: { officeId } });
    await prisma.office.delete({ where: { id: officeId } });
    await prisma.$disconnect();
  });

  const person = (lname: string, fname: string, extra: Record<string, unknown> = {}) =>
    prisma.citizen.create({ data: { personLname: lname, personFname: fname, personBdate: new Date('1970-01-01'), ...extra } });
  const cash = (personKey: string, amount: number, createdAt?: Date) =>
    prisma.officeRecord.create({ data: { moduleId: cashId, personKey, data: { amount_php: amount }, createdBy: actor, updatedBy: actor, ...(createdAt ? { createdAt } : {}) } });
  const packs = (personKey: string) => prisma.officeRecord.create({ data: { moduleId: packsId, personKey, data: {}, createdBy: actor, updatedBy: actor } });

  // Abad household (two people, four releases), Bello (one), Cruz (none in
  // the last year), and Dizon, who is in no household.
  async function city() {
    const abad = await person('ABAD', 'ANA', { personIsHead: true, personBrgyCode: brgy });
    const abadSpouse = await person('ABAD', 'BEN', { personParentKey: abad.personKey, personRelationToHead: 'Spouse' });
    const bello = await person('BELLO', 'CARLA', { personIsHead: true });
    const cruz = await person('CRUZ', 'DANTE', { personIsHead: true });
    const dizon = await person('DIZON', 'ELSA');
    await cash(abad.personKey, 5000);
    await cash(abadSpouse.personKey, 3000);
    await packs(abad.personKey);
    await packs(abadSpouse.personKey);
    await cash(bello.personKey, 1000);
    await cash(dizon.personKey, 500);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    await cash(cruz.personKey, 9000, twoYearsAgo);
    return { abad, abadSpouse, bello, cruz, dizon };
  }

  it('adds up releases per household and per program for the last 12 months', async () => {
    await city();
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/assistance');
    expect(res.status).toBe(200);
    expect(res.body.households).toEqual({ total: 3, never: 1, once: 1, few: 0, many: 1 });
    expect(res.body).toMatchObject({ releases: 6, value: 9500, releasesOutsideHouseholds: 1 });
    expect(res.body.programs).toEqual([
      expect.objectContaining({ name: 'Cash Aid (test)', hasAmount: true, releases: 4, recipients: 3, value: 9500 }),
      expect.objectContaining({ name: 'Food Packs (test)', hasAmount: false, releases: 2, recipients: 1, value: 0 }),
    ]);
  });

  it('follows the period and the barangay', async () => {
    await city();
    const agent = await loginAgent(app, 'admin.demo');
    const from = new Date();
    from.setFullYear(from.getFullYear() - 3);
    const wide = await agent.get('/admin/assistance').query({ from: from.toISOString().slice(0, 10) });
    expect(wide.body.households.never).toBe(0);
    expect(wide.body.value).toBe(18500);

    const one = await agent.get('/admin/assistance').query({ barangayCode: brgy });
    expect(one.body.households).toMatchObject({ total: 1, many: 1, never: 0 });
    expect(one.body).toMatchObject({ releases: 4, value: 8000 });

    expect((await agent.get('/admin/assistance').query({ from: '2026-13-40' })).status).toBe(400);
    expect((await agent.get('/admin/assistance/list').query({ times: 'often' })).status).toBe(400);
  });

  it('lists households, most assisted first, or only those not assisted, and logs who was shown', async () => {
    const { abad, cruz } = await city();
    const agent = await loginAgent(app, 'admin.demo');
    const all = await agent.get('/admin/assistance/list');
    expect(all.body.total).toBe(3);
    expect(all.body.items[0]).toMatchObject({ headKey: abad.personKey, head: 'ABAD, ANA', members: 2, releases: 4, value: 8000, programs: 'Cash Aid (test), Food Packs (test)' });

    const never = await agent.get('/admin/assistance/list').query({ times: 'never' });
    expect(never.body.items.map((h: { headKey: string }) => h.headKey)).toEqual([cruz.personKey]);
    expect(never.body.items[0]).toMatchObject({ releases: 0, programs: null, lastOn: null });

    const csv = await agent.get('/admin/assistance/list.csv').query({ times: 'many' });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Household head,Barangay,Members,Times assisted');
    expect(csv.text).toContain('"ABAD, ANA"');

    const logs = await prisma.auditLog.findMany({ where: { action: 'read', tableName: 'Citizen' } });
    const views = logs.map((l) => (l.changedFields as { view?: string }).view);
    expect(views).toEqual(expect.arrayContaining(['assistance:list', 'assistance:export']));
  });

  it("shows on the household's page what the household received", async () => {
    const { abad } = await city();
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get(`/admin/households/${abad.personKey}`);
    expect(res.body.assistance).toHaveLength(4);
    const amounts = res.body.assistance.map((a: { program: string; amount: number | null }) => [a.program, a.amount]);
    expect(amounts).toEqual(expect.arrayContaining([['Cash Aid (test)', 5000], ['Cash Aid (test)', 3000], ['Food Packs (test)', null]]));
  });

  it('leaves out archived records and programs not counted as assistance', async () => {
    const { bello } = await city();
    await prisma.officeRecord.updateMany({ where: { personKey: bello.personKey }, data: { isArchived: true } });
    const senior = await prisma.officeModule.findFirstOrThrow({ where: { slug: 'senior', office: { slug: 'cswd' } } });
    await prisma.officeRecord.create({ data: { moduleId: senior.id, personKey: bello.personKey, data: {}, createdBy: actor, updatedBy: actor } });
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/assistance');
    expect(res.body.households).toMatchObject({ never: 2, once: 0 });
    expect(res.body.releases).toBe(5);
  });

  it('is switched on per program, with an amount field that must be one of its number fields', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const patch = (body: Record<string, unknown>) => agent.patch(`/admin/offices/${officeId}/modules/${cashId}`).send(body);
    expect((await patch({ assistanceAmountKey: 'purpose' })).status).toBe(400);
    expect((await patch({ assistanceAmountKey: 'no_such_field' })).status).toBe(400);
    expect((await patch({ assistanceAmountKey: null })).body).toMatchObject({ givesAssistance: true, assistanceAmountKey: null });
    expect((await patch({ assistanceAmountKey: 'amount_php' })).body).toMatchObject({ givesAssistance: true, assistanceAmountKey: 'amount_php' });
    // Switching it off drops the amount field; switching it back on starts without one.
    expect((await patch({ givesAssistance: false })).body).toMatchObject({ givesAssistance: false, assistanceAmountKey: null });
    expect((await patch({ givesAssistance: true, assistanceAmountKey: 'amount_php' })).body).toMatchObject({ givesAssistance: true, assistanceAmountKey: 'amount_php' });
  });

  it('is for the administrator; office staff are refused', async () => {
    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.get('/admin/assistance')).status).toBe(403);
    expect((await staff.get('/admin/assistance/list')).status).toBe(403);
  });
});
