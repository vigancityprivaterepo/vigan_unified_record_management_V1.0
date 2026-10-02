import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

// A link-optional program added to the seeded Agriculture office (agri.demo).
describe('linking saved records to the registry', () => {
  const app = createApp();
  let officeId = '';
  let moduleId = '';
  const base = () => `/offices/${officeId}/modules/${moduleId}/registry-links`;

  beforeAll(async () => {
    officeId = (await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } })).id;
    moduleId = (await prisma.officeModule.create({ data: { officeId, name: 'Owners', slug: 'owners_test', requiresCitizenLink: false } })).id;
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.officeRecord.deleteMany({ where: { moduleId } });
    await prisma.officeModule.delete({ where: { id: moduleId } });
    await prisma.$disconnect();
  });

  const citizen = (lname: string, fname: string, bdate: string) =>
    prisma.citizen.create({ data: { personLname: lname, personFname: fname, personBdate: new Date(bdate) } });
  const record = (lname: string, fname: string, bdate = '') =>
    prisma.officeRecord.create({ data: { moduleId, unresolvedPerson: { lname, fname, bdate }, data: { business_name: `${lname} STORE` } } });

  it('suggests matches, marks only exact name + same birthdate as sure, and links the sure ones in bulk', async () => {
    const juan = await citizen('DELA CRUZ', 'JUAN', '1970-01-01');
    await citizen('DELA CRUZ', 'JUANA', '1972-02-02');
    const sure = await record('Dela Cruz', 'Juan', '1970-01-01');
    const nameOnly = await record('DELA CRUZ', 'JUAN');
    await record('NOBODY', 'HERE');
    const agent = await loginAgent(app, 'agri.demo');

    const res = await agent.get(base());
    expect(res.status).toBe(200);
    expect([res.body.unlinked, res.body.withCandidates, res.body.sure]).toEqual([3, 2, 1]);
    expect(res.body.items[0]).toMatchObject({ recordId: sure.id, sure: true });
    expect(res.body.items[1].candidates[0]).toMatchObject({ personKey: juan.personKey, exactName: true, sameBirthdate: false });

    expect((await agent.post(`${base()}/sure`)).body).toEqual({ linked: 1 });
    expect((await prisma.officeRecord.findUniqueOrThrow({ where: { id: sure.id } })).personKey).toBe(juan.personKey);
    expect((await prisma.officeRecord.findUniqueOrThrow({ where: { id: nameOnly.id } })).personKey).toBeNull();
  });

  it('links one record after staff confirm, keeps the recorded name, and logs it', async () => {
    const juan = await citizen('DELA CRUZ', 'JUAN', '1970-01-01');
    const rec = await record('DELA CRUZ', 'JUAN');
    const agent = await loginAgent(app, 'agri.demo');
    expect((await agent.post(base()).send({ recordId: rec.id, personKey: juan.personKey })).status).toBe(200);
    const after = await prisma.officeRecord.findUniqueOrThrow({ where: { id: rec.id } });
    expect(after.personKey).toBe(juan.personKey);
    expect(after.unresolvedPerson).toMatchObject({ lname: 'DELA CRUZ' });
    expect((await agent.post(base()).send({ recordId: rec.id, personKey: juan.personKey })).status).toBe(409);
    const log = await prisma.auditLog.findFirst({ where: { recordId: rec.id, action: 'update' } });
    expect(log?.changedFields).toMatchObject({ event: 'registry_link', how: 'confirmed', personKey: juan.personKey });
  });

  it('lets admin look but not link, and refuses other offices', async () => {
    const admin = await loginAgent(app, 'admin.demo');
    expect((await admin.get(base())).status).toBe(200);
    expect((await admin.post(`${base()}/sure`)).status).toBe(403);
    const cswd = await loginAgent(app, 'cswd.demo');
    expect((await cswd.get(base())).status).toBe(403);
  });
});
