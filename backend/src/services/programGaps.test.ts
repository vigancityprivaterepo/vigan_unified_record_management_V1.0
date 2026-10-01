import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { getPrismaForRole } from '../lib/prismaByRole';
import { resetDb } from '../testUtils/resetDb';
import { countGap, listGapPeople, type GapRule } from './programGaps';

// Uses the seeded CSWD Senior Citizen ('senior') and Civil Registry Death
// ('death') modules; rules are built in memory, not stored.
describe('program gaps', () => {
  let seniorId = '';
  let deathId = '';
  const yearsAgo = (y: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() - 1); return d; };
  const rule = (over: Partial<GapRule>): GapRule => ({
    id: '00000000-0000-0000-0000-000000000000', name: 't', description: null, kind: 'missing', targetModuleId: seniorId,
    sourceModuleIds: [], minAge: null, maxAge: null, sex: null, isActive: true, ...over,
  });
  async function person(lname: string, age: number, modules: string[]) {
    const c = await prisma.citizen.create({ data: { personLname: lname, personFname: 'Test', personBdate: yearsAgo(age), personSex: 'F' }, select: { personKey: true } });
    for (const moduleId of modules) await prisma.officeRecord.create({ data: { moduleId, personKey: c.personKey, data: {} } });
    return c.personKey;
  }

  beforeEach(async () => {
    await resetDb();
    seniorId = (await prisma.officeModule.findFirstOrThrow({ where: { slug: 'senior' } })).id;
    deathId = (await prisma.officeModule.findFirstOrThrow({ where: { slug: 'death' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('missing: finds people in the age range who are not on the target list, and skips the deceased', async () => {
    await person('Notlisted', 65, []);
    await person('Listed', 70, [seniorId]);
    await person('Young', 59, []);
    await person('Deceased', 80, [deathId]);
    const r = rule({ minAge: 60 });
    const client = getPrismaForRole('admin');
    expect((await countGap(client, r, {})).total).toBe(1);
    const people = await listGapPeople(client, r, {}, null);
    expect(people.map((p) => p.name)).toEqual(['Notlisted, Test']);
    expect(people[0]?.age).toBe(65);
  });

  it('conflict: finds people with a death record who are still on the list, and names only the rule evidence', async () => {
    await person('StillListed', 81, [seniorId, deathId]);
    await person('Alive', 75, [seniorId]);
    const r = rule({ kind: 'conflict', sourceModuleIds: [deathId] });
    const people = await listGapPeople(getPrismaForRole('admin'), r, {}, null);
    expect(people.map((p) => p.name)).toEqual(['StillListed, Test']);
    expect(people[0]?.sourcePrograms).toEqual(['Death']);
  });

  it('max age is inclusive in whole years', async () => {
    await person('One', 1, []);
    await person('Two', 2, []);
    const people = await listGapPeople(getPrismaForRole('admin'), rule({ maxAge: 1 }), {}, null);
    expect(people.map((p) => p.name)).toEqual(['One, Test']);
  });
});
