import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actor = '00000000-0000-0000-0000-000000000000';

describe('printing a certification or ID from a record', () => {
  const app = createApp();
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup() {
    const mod = (office: string, slug: string) => prisma.officeModule.findFirstOrThrow({ where: { slug, office: { slug: office } } });
    const senior = await mod('cswd', 'senior');
    const death = await mod('civil_registry', 'death');
    const birth = await mod('civil_registry', 'birth');
    const person = await prisma.citizen.create({
      data: { personLname: 'DOMINGO', personFname: 'RAMON', personMname: 'TOLENTINO', personBdate: new Date('1955-01-01'), personSex: 'M', personCivilStatus: 'Married', personStreet: 'PUROK 2', personBrgyCode: 'VIG-008' },
    });
    const record = await prisma.officeRecord.create({ data: { moduleId: senior.id, personKey: person.personKey, data: { has_id: true, _sample: true }, createdBy: actor, updatedBy: actor } });
    const url = (officeId: string, moduleId: string, recordId: string) => `/offices/${officeId}/modules/${moduleId}/records/${recordId}/print`;
    return { senior, death, birth, person, record, url, print: url(senior.officeId, senior.id, record.id) };
  }

  it('returns what the sheet needs and records who printed it', async () => {
    const { print, record, person } = await setup();
    const staff = await loginAgent(app, 'cswd.demo');
    const res = await staff.post(print).send({ kind: 'certificate' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'certificate',
      program: { name: 'Senior Citizen', slug: 'senior' },
      person: { lname: 'DOMINGO', fname: 'RAMON', bdate: '1955-01-01', sex: 'M', street: 'PUROK 2', barangay: 'Paoa' },
      record: { id: record.id, sample: true, values: { has_id: true } },
      printedBy: 'CSWD Demo Staff',
    });
    expect(res.body.record.values).not.toHaveProperty('_sample');
    expect(res.body.fields.map((f: { key: string }) => f.key)).toEqual(['has_id']);
    expect((await staff.post(print).send({ kind: 'id_card' })).status).toBe(200);

    const logged = (await prisma.auditLog.findMany({ where: { tableName: 'OfficeRecord', recordId: record.id, action: 'read' } })).map((l) => l.changedFields as Record<string, unknown>);
    expect(logged.map((f) => f.kind).sort()).toEqual(['certificate', 'id_card']);
    expect(logged[0]).toMatchObject({ event: 'printed', personKeys: [person.personKey] });
  });

  it('refuses bad input, another office, an archived record and an unlinked record', async () => {
    const { print, record, senior, birth, url } = await setup();
    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.post(print).send({ kind: 'diploma' })).status).toBe(400);
    expect((await (await loginAgent(app, 'agri.demo')).post(print).send({ kind: 'certificate' })).status).toBe(403);

    const unlinked = await prisma.officeRecord.create({ data: { moduleId: birth.id, personKey: null, unresolvedPerson: { lname: 'X', fname: 'Y', bdate: '2026-01-01' }, data: {}, createdBy: actor, updatedBy: actor } });
    const civil = await loginAgent(app, 'civilreg.demo');
    const notLinked = await civil.post(url(birth.officeId, birth.id, unlinked.id)).send({ kind: 'certificate' });
    expect(notLinked.status).toBe(409);
    expect(notLinked.body.error.code).toBe('NOT_LINKED');

    await prisma.officeRecord.update({ where: { id: record.id }, data: { isArchived: true } });
    expect((await staff.post(print).send({ kind: 'certificate' })).status).toBe(404);
    expect((await staff.post(url(senior.officeId, senior.id, unlinked.id)).send({ kind: 'certificate' })).status).toBe(404);
  });

  it('refuses a person with a death record, except from the Death program itself', async () => {
    const { print, death, person, url } = await setup();
    const dead = await prisma.officeRecord.create({ data: { moduleId: death.id, personKey: person.personKey, data: { place_of_death: 'VIGAN CITY' }, createdBy: actor, updatedBy: actor } });
    const res = await (await loginAgent(app, 'cswd.demo')).post(print).send({ kind: 'id_card' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DECEASED');
    expect((await (await loginAgent(app, 'civilreg.demo')).post(url(death.officeId, death.id, dead.id)).send({ kind: 'certificate' })).status).toBe(200);
  });
});
