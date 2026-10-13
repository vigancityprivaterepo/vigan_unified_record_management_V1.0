import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { mergeCitizens } from '../services/mergeCitizens';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actor = '00000000-0000-0000-0000-000000000000';

describe("a household's living conditions", () => {
  const app = createApp();

  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const person = (lname: string, fname: string, bdate: string, extra: Record<string, unknown> = {}) =>
    prisma.citizen.create({ data: { personLname: lname, personFname: fname, personBdate: new Date(bdate), ...extra } });

  // Ramon heads the household; Corazon is his spouse.
  async function family() {
    const head = await person('DOMINGO', 'RAMON', '1955-01-01', { personIsHead: true, personRelationToHead: 'Head', personCivilStatus: 'Married' });
    const spouse = await person('DOMINGO', 'CORAZON', '1957-04-04', { personParentKey: head.personKey, personRelationToHead: 'Spouse', personCivilStatus: 'Married' });
    return { head, spouse };
  }
  const profileOf = (headPersonKey: string) => prisma.householdProfile.findUnique({ where: { headPersonKey } });

  it('is empty until recorded, then saved and shown with the household', async () => {
    const { head } = await family();
    const agent = await loginAgent(app, 'admin.demo');

    const before = await agent.get(`/admin/households/${head.personKey}`);
    expect(before.status).toBe(200);
    expect(before.body.profile).toBeNull();
    expect(before.body.profileFields.map((f: { key: string }) => f.key)).toContain('toiletFacility');

    const saved = await agent.put(`/admin/households/${head.personKey}/profile`).send({ waterSource: 'piped_dwelling', electricity: 'yes' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ source: 'office', values: { waterSource: 'piped_dwelling', electricity: 'yes', toiletFacility: null } });

    const after = await agent.get(`/admin/households/${head.personKey}`);
    expect(after.body.profile.values.waterSource).toBe('piped_dwelling');
  });

  it('keeps the answers a later save leaves out, clears one sent as null, and logs what changed', async () => {
    const { head } = await family();
    const agent = await loginAgent(app, 'admin.demo');
    await agent.put(`/admin/households/${head.personKey}/profile`).send({ waterSource: 'piped_dwelling', electricity: 'yes' });
    const res = await agent.put(`/admin/households/${head.personKey}/profile`).send({ toiletFacility: 'flush_septic', electricity: null });
    expect(res.body.values).toMatchObject({ waterSource: 'piped_dwelling', toiletFacility: 'flush_septic', electricity: null });

    const logs = await prisma.auditLog.findMany({ where: { tableName: 'household_profile' }, orderBy: { timestamp: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['insert', 'update']);
    expect(logs[1]?.changedFields).toMatchObject({ toiletFacility: { from: null, to: 'flush_septic' }, electricity: { from: 'yes', to: null } });
    expect(logs[1]?.changedFields).not.toHaveProperty('waterSource');
  });

  it('refuses an answer that is not on the list, and a person who heads no household', async () => {
    const { head, spouse } = await family();
    const agent = await loginAgent(app, 'admin.demo');
    expect((await agent.put(`/admin/households/${head.personKey}/profile`).send({ waterSource: 'river' })).status).toBe(400);
    expect((await agent.put(`/admin/households/${head.personKey}/profile`).send({ income: 'low' })).status).toBe(400);
    expect((await agent.put(`/admin/households/${spouse.personKey}/profile`).send({ electricity: 'yes' })).status).toBe(404);
    expect(await profileOf(head.personKey)).toBeNull();
  });

  it('is only for the administrator', async () => {
    const { head } = await family();
    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.put(`/admin/households/${head.personKey}/profile`).send({ electricity: 'yes' })).status).toBe(403);
  });

  it('goes to the new head when Civil Registry records the death of the head', async () => {
    const { head, spouse } = await family();
    const admin = await loginAgent(app, 'admin.demo');
    await admin.put(`/admin/households/${head.personKey}/profile`).send({ roofMaterial: 'metal_sheet' });

    const death = await prisma.officeModule.findFirstOrThrow({ where: { slug: 'death', office: { slug: 'civil_registry' } } });
    const civil = await loginAgent(app, 'civilreg.demo');
    const res = await civil.post(`/offices/${death.officeId}/modules/${death.id}/records`)
      .field('lname', head.personLname).field('fname', head.personFname).field('bdate', '1955-01-01')
      .field('fields', JSON.stringify({ place_of_death: 'Vigan City', cause_of_death: 'Natural causes' }));
    expect(res.status).toBe(201);

    expect(await profileOf(head.personKey)).toBeNull();
    expect(await profileOf(spouse.personKey)).toMatchObject({ roofMaterial: 'metal_sheet' });
    const shown = await admin.get(`/admin/households/${spouse.personKey}`);
    expect(shown.body.profile.values.roofMaterial).toBe('metal_sheet');
  });

  it('follows a merge of two records of the head, unless the kept record has its own', async () => {
    const { head } = await family();
    const duplicate = await person('DOMINGO', 'RAMON', '1955-01-01');
    const admin = await loginAgent(app, 'admin.demo');
    await admin.put(`/admin/households/${head.personKey}/profile`).send({ wallMaterial: 'concrete' });

    await prisma.$transaction((tx) => mergeCitizens(tx, duplicate.personKey, head.personKey, actor));
    expect(await profileOf(duplicate.personKey)).toMatchObject({ wallMaterial: 'concrete' });

    // The other way round: both have one, the kept record's stays.
    const other = await person('REYES', 'JUAN', '1960-01-01', { personIsHead: true });
    await admin.put(`/admin/households/${other.personKey}/profile`).send({ wallMaterial: 'wood_bamboo' });
    await prisma.$transaction((tx) => mergeCitizens(tx, other.personKey, duplicate.personKey, actor));
    expect(await profileOf(other.personKey)).toMatchObject({ wallMaterial: 'wood_bamboo' });
  });

  it('is removed when the household is disbanded', async () => {
    const solo = await person('LAZO', 'MARIA', '1964-01-01', { personIsHead: true });
    const agent = await loginAgent(app, 'admin.demo');
    await agent.put(`/admin/households/${solo.personKey}/profile`).send({ internetAccess: 'none' });
    expect((await agent.delete(`/admin/households/${solo.personKey}`)).status).toBe(204);
    expect(await profileOf(solo.personKey)).toBeNull();
  });
});
