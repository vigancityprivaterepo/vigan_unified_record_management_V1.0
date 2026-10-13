import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { nameKey } from '../lib/nameKey';
import { prisma } from '../lib/prisma';
import { resolvePerson } from '../services/resolvePerson';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const app = createApp();
const born = (day: string) => new Date(`${day}T00:00:00.000Z`);
const citizen = (lname: string, fname: string, day: string, extra: Record<string, unknown> = {}) =>
  prisma.citizen.create({ data: { personLname: lname, personFname: fname, personBdate: born(day), ...extra } });

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM citizen_distinct_pair`;
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('names typed differently are the same person', () => {
  it('matches on the name key, not the spelling', async () => {
    const maria = await citizen('Dela Cruz', 'Maria Cristina', '1990-04-12');
    for (const [lname, fname] of [['DE LA CRUZ', 'MA. CRISTINA'], ['dela  cruz', 'Maria-Cristina'], ['Dela Cruz,', 'MA CRISTINA']]) {
      expect(await resolvePerson({ lname: lname!, fname: fname!, bdate: born('1990-04-12') }), `${lname}, ${fname}`).toEqual({ status: 'matched', personKey: maria.personKey });
    }
    const pedro = await citizen('Peñaflor', 'Pedro', '1975-01-30');
    expect(await resolvePerson({ lname: 'PENAFLOR', fname: 'PEDRO JR.', bdate: born('1975-01-30') })).toEqual({ status: 'matched', personKey: pedro.personKey });
    // The same name on another birthdate is still another person.
    expect((await resolvePerson({ lname: 'Dela Cruz', fname: 'Maria Cristina', bdate: born('1962-11-03') })).status).toBe('created');
  });

  it('the database and the code build the same key', async () => {
    const names = ['Ma. Cristina', 'MARIA  CRISTINA', 'Dela Cruz', 'DE LA CRUZ', 'Peñaflor Jr.', 'Sta. Maria', 'Sto. Niño', 'JUAN III', "O'Brien-Reyes"];
    const rows = await prisma.$queryRaw<Array<{ key: string }>>`SELECT name_key(n) AS key FROM unnest(${names}::text[]) WITH ORDINALITY AS t(n, i) ORDER BY i`;
    expect(rows.map((r) => r.key)).toEqual(names.map(nameKey));
  });
});

describe('/admin/duplicate-citizens', () => {
  const pairs = async (agent: Awaited<ReturnType<typeof loginAgent>>) =>
    ((await agent.get('/admin/duplicate-citizens')).body.items as Array<{ reason: string; a: { fname: string }; b: { fname: string } }>)
      .map((p) => [p.reason, ...[p.a.fname, p.b.fname].sort()].join('|')).sort();

  it('lists likely duplicates and nobody else', async () => {
    // A middle name typed into the first name; a birthdate one digit off; day and month swapped.
    await citizen('Reyes', 'Juan', '1980-05-17');
    await citizen('Reyes', 'Juan Santos', '1980-05-17');
    await citizen('Bautista', 'Ana', '1971-03-08');
    await citizen('Bautista', 'Ana', '1971-03-09');
    await citizen('Flores', 'Luz', '1966-02-11');
    await citizen('Flores', 'Luz', '1966-11-02');
    // The same name, saved once without a birthdate.
    await citizen('Mercado', 'Rosa', '1959-12-25');
    await prisma.citizen.create({ data: { personLname: 'MERCADO', personFname: 'ROSA' } });
    // Not duplicates: a parent and child with the same name, and unrelated people born the same day.
    await citizen('Garcia', 'Pedro', '1950-06-01');
    await citizen('Garcia', 'Pedro', '1978-09-23');
    await citizen('Navarro', 'Elena', '1980-05-17');

    const agent = await loginAgent(app, 'admin.demo');
    expect(await pairs(agent)).toEqual(['birthdate_typo|Ana|Ana', 'birthdate_typo|Luz|Luz', 'no_birthdate|ROSA|Rosa', 'similar_name|Juan|Juan Santos']);
    expect((await (await loginAgent(app, 'cswd.demo')).get('/admin/duplicate-citizens')).status).toBe(403);
  });

  it('"different people" takes a pair off the list for good', async () => {
    const one = await citizen('Cruz', 'Juan', '2015-08-08');
    const twin = await citizen('Cruz', 'Juana', '2015-08-08');
    const agent = await loginAgent(app, 'admin.demo');
    expect(await pairs(agent)).toHaveLength(1);
    expect((await agent.post('/admin/duplicate-citizens/distinct').send({ keepPersonKey: twin.personKey, otherPersonKey: one.personKey })).status).toBe(204);
    expect(await pairs(agent)).toEqual([]);
  });

  it('merging keeps one citizen with the records, missing details and household of both', async () => {
    const office = await prisma.office.create({ data: { name: 'Merge Test Office', slug: `merge_test_${Date.now()}` } });
    const program = await prisma.officeModule.create({ data: { officeId: office.id, name: 'Merge Test Program', slug: `merge_test_${Date.now()}` } });
    try {
      const keep = await citizen('Reyes', 'Juan', '1980-05-17', { personSex: 'M' });
      const other = await citizen('Reyes', 'Juan Santos', '1980-05-17', { personIsHead: true, personOccupation: 'FARMER', personSex: 'F' });
      const child = await citizen('Reyes', 'Nico', '2010-01-01', { personParentKey: other.personKey, personRelationToHead: 'Son' });
      await prisma.officeRecord.create({ data: { moduleId: program.id, personKey: other.personKey, data: {} } });

      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.post('/admin/duplicate-citizens/merge').send({ keepPersonKey: keep.personKey, otherPersonKey: other.personKey });
      expect(res.status).toBe(200);

      // Kept: its own sex, the other's occupation and household.
      expect(await prisma.citizen.findUniqueOrThrow({ where: { personKey: keep.personKey } })).toMatchObject({ personSex: 'M', personOccupation: 'FARMER', personIsHead: true, isArchived: false });
      expect((await prisma.citizen.findUniqueOrThrow({ where: { personKey: other.personKey } })).isArchived).toBe(true);
      expect((await prisma.citizen.findUniqueOrThrow({ where: { personKey: child.personKey } })).personParentKey).toBe(keep.personKey);
      expect(await prisma.officeRecord.count({ where: { moduleId: program.id, personKey: keep.personKey } })).toBe(1);
      expect(await pairs(agent)).toEqual([]);

      // Already merged: cannot be merged again.
      expect((await agent.post('/admin/duplicate-citizens/merge').send({ keepPersonKey: keep.personKey, otherPersonKey: other.personKey })).status).toBe(404);
    } finally {
      await prisma.officeRecord.deleteMany({ where: { moduleId: program.id } });
      await prisma.officeModule.delete({ where: { id: program.id } });
      await prisma.office.delete({ where: { id: office.id } });
    }
  });
});
