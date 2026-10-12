import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actor = '00000000-0000-0000-0000-000000000000';

// Civil Registry (civilreg.demo, an office_staff login) records a death; the
// seeded CSWD Senior Citizen list is the one program a cleanup rule covers,
// and the Agriculture Farmer program stands in for history that must stay.
describe('recording a death updates the household and program lists', () => {
  const app = createApp();
  let civilId = '';
  let deathId = '';
  let seniorId = '';
  let farmerId = '';
  let ruleId = '';

  beforeAll(async () => {
    const mod = (office: string, slug: string) => prisma.officeModule.findFirstOrThrow({ where: { slug, office: { slug: office } } });
    const death = await mod('civil_registry', 'death');
    civilId = death.officeId;
    deathId = death.id;
    seniorId = (await mod('cswd', 'senior')).id;
    farmerId = (await mod('agriculture', 'farmer')).id;
    ruleId = (await prisma.programGapRule.create({ data: { name: 'Deceased still on the Senior list (test)', kind: 'conflict', targetModuleId: seniorId, sourceModuleIds: [deathId] } })).id;
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.programGapRule.delete({ where: { id: ruleId } });
    await prisma.$disconnect();
  });

  const person = (lname: string, fname: string, bdate: string, extra: Record<string, unknown> = {}) =>
    prisma.citizen.create({ data: { personLname: lname, personFname: fname, personBdate: new Date(bdate), ...extra } });
  const enroll = (moduleId: string, personKey: string) =>
    prisma.officeRecord.create({ data: { moduleId, personKey, data: {}, createdBy: actor, updatedBy: actor } });
  const get = (personKey: string) => prisma.citizen.findUniqueOrThrow({ where: { personKey } });

  // Ramon (head, a senior and a farmer), Corazon (spouse), Elena (daughter).
  async function family() {
    const head = await person('DOMINGO', 'RAMON', '1955-01-01', { personIsHead: true, personRelationToHead: 'Head', personCivilStatus: 'Married' });
    const spouse = await person('DOMINGO', 'CORAZON', '1957-04-04', { personParentKey: head.personKey, personRelationToHead: 'Spouse', personCivilStatus: 'Married' });
    const child = await person('DOMINGO', 'ELENA', '1980-10-10', { personParentKey: head.personKey, personRelationToHead: 'Daughter' });
    const senior = await enroll(seniorId, head.personKey);
    const farmer = await enroll(farmerId, head.personKey);
    return { head, spouse, child, senior, farmer };
  }
  type Agent = Awaited<ReturnType<typeof loginAgent>>;
  const recordDeath = (agent: Agent, p: { personLname: string; personFname: string; personBdate: Date | null }) =>
    agent.post(`/offices/${civilId}/modules/${deathId}/records`)
      .field('lname', p.personLname).field('fname', p.personFname).field('bdate', p.personBdate!.toISOString().slice(0, 10))
      .field('fields', JSON.stringify({ place_of_death: 'Vigan City', cause_of_death: 'Natural causes' }));

  it('when the head dies: the spouse heads the household, the lists are cleaned, the death record stays', async () => {
    const f = await family();
    const agent = await loginAgent(app, 'civilreg.demo');
    const res = await recordDeath(agent, f.head);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('matched');
    expect(res.body.deathEffects).toEqual({ removedFrom: ['Senior Citizen'], household: { head: 'CORAZON DOMINGO', newHead: true } });

    expect(await get(f.spouse.personKey)).toMatchObject({ personIsHead: true, personParentKey: null, personRelationToHead: 'Head', personCivilStatus: 'Widowed' });
    expect((await get(f.child.personKey)).personParentKey).toBe(f.spouse.personKey);
    expect(await get(f.head.personKey)).toMatchObject({ personIsHead: false, personParentKey: null, isArchived: false });

    // Off the list a cleanup rule covers; history elsewhere is untouched.
    expect((await prisma.officeRecord.findUniqueOrThrow({ where: { id: f.senior.id } })).isArchived).toBe(true);
    expect((await prisma.officeRecord.findUniqueOrThrow({ where: { id: f.farmer.id } })).isArchived).toBe(false);
    const death = await prisma.officeRecord.findUniqueOrThrow({ where: { id: res.body.recordId } });
    expect(death).toMatchObject({ isArchived: false, personKey: f.head.personKey });

    // Gone from the Citizens list and the household; the household lists under its new head.
    const admin = await loginAgent(app, 'admin.demo');
    const citizens = await admin.get('/admin/citizens').query({ q: 'DOMINGO' });
    expect(citizens.body.items.map((c: { personFname: string }) => c.personFname).sort()).toEqual(['CORAZON', 'ELENA']);
    const households = await admin.get('/admin/households').query({ q: 'DOMINGO' });
    expect(households.body.items).toHaveLength(1);
    expect(households.body.items[0]).toMatchObject({ personKey: f.spouse.personKey, memberCount: 2 });
  });

  it('when a member dies: they leave the household and a married head becomes widowed', async () => {
    const f = await family();
    const agent = await loginAgent(app, 'civilreg.demo');
    const res = await recordDeath(agent, f.spouse);
    expect(res.body.deathEffects).toEqual({ removedFrom: [], household: { head: 'RAMON DOMINGO', newHead: false } });
    expect((await get(f.spouse.personKey)).personParentKey).toBeNull();
    expect(await get(f.head.personKey)).toMatchObject({ personIsHead: true, personCivilStatus: 'Widowed' });
    expect((await get(f.child.personKey)).personParentKey).toBe(f.head.personKey);
  });

  it('archiving a death record entered by mistake puts the person back; restoring it applies again', async () => {
    const f = await family();
    const agent = await loginAgent(app, 'civilreg.demo');
    const res = await recordDeath(agent, f.head);
    const url = `/offices/${civilId}/modules/${deathId}/records/${res.body.recordId as string}`;

    expect((await agent.delete(url).send({ reason: 'Wrong person' })).status).toBe(204);
    expect((await prisma.officeRecord.findUniqueOrThrow({ where: { id: f.senior.id } })).isArchived).toBe(false);
    // Back in the household as a member; the spouse stays head and is married again.
    expect(await get(f.head.personKey)).toMatchObject({ personIsHead: false, personParentKey: f.spouse.personKey });
    expect(await get(f.spouse.personKey)).toMatchObject({ personIsHead: true, personCivilStatus: 'Married' });
    const archived = await prisma.officeRecord.findUniqueOrThrow({ where: { id: res.body.recordId } });
    expect(archived.data).not.toHaveProperty('_effects');

    expect((await agent.post(`${url}/restore`).send({ reason: 'It was right after all' })).status).toBe(204);
    expect((await prisma.officeRecord.findUniqueOrThrow({ where: { id: f.senior.id } })).isArchived).toBe(true);
    expect((await get(f.head.personKey)).personParentKey).toBeNull();
  });

  it('a person living alone, and every other program, are left as they are', async () => {
    const loner = await person('SOLO', 'PEDRO', '1950-02-02', { personIsHead: true });
    const agent = await loginAgent(app, 'civilreg.demo');
    const res = await recordDeath(agent, loner);
    expect(res.body.deathEffects).toEqual({ removedFrom: [], household: null });
    expect((await get(loner.personKey)).personIsHead).toBe(false);

    // A non-death program never triggers any of this.
    const f = await family();
    const cswd = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
    const staff = await loginAgent(app, 'cswd.demo');
    const senior = await staff.post(`/offices/${cswd.id}/modules/${seniorId}/records`)
      .field('lname', 'DOMINGO').field('fname', 'CORAZON').field('bdate', '1957-04-04').field('fields', JSON.stringify({ has_id: true }));
    expect(senior.status).toBe(201);
    expect(senior.body.deathEffects).toBeUndefined();
    expect((await get(f.head.personKey)).personIsHead).toBe(true);
  });
});
