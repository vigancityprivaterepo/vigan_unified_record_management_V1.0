import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { getPrismaForRole } from '../lib/prismaByRole';
import { resetDb } from '../testUtils/resetDb';
import { pace, quality, reach, underserved } from './cityInsights';
import { cityAttention } from './cityAttention';
import { countGap, toGapRule } from './programGaps';

// Seeded CSWD Senior Citizen ('senior') module; one "Not yet served" rule.
describe('city insights', () => {
  let seniorId = '';
  let ruleId = '';
  let brgy = { code: '', name: '' };
  const yearsAgo = (y: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() - 1); return d; };
  const person = (lname: string, age: number, extra: Record<string, unknown> = {}) =>
    prisma.citizen.create({ data: { personLname: lname, personFname: 'T', personBdate: yearsAgo(age), personSex: 'F', personBrgyCode: brgy.code, ...extra } });

  beforeAll(async () => {
    seniorId = (await prisma.officeModule.findFirstOrThrow({ where: { slug: 'senior' } })).id;
    brgy = await prisma.barangay.findFirstOrThrow({ select: { code: true, name: true } });
    ruleId = (await prisma.programGapRule.create({ data: { name: 'Seniors not listed', kind: 'missing', targetModuleId: seniorId, minAge: 60 } })).id;
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.programGapRule.delete({ where: { id: ruleId } });
    await prisma.$disconnect();
  });

  it('ranks barangays by people not yet served, as a share of residents', async () => {
    await person('Unserved', 70);
    const served = await person('Served', 72);
    await prisma.officeRecord.create({ data: { moduleId: seniorId, personKey: served.personKey, data: {} } });
    await person('Young', 30);
    const u = await underserved(getPrismaForRole('admin'));
    const b = u.barangays.find((x) => x.code === brgy.code)!;
    expect([b.residents, b.notServed, b.byRule[ruleId]]).toEqual([3, 1, 1]);
  });

  it('counts households by programs, and vulnerable households in none', async () => {
    const head = await person('Head', 70, { personIsHead: true });
    await person('Kid', 2, { personParentKey: head.personKey });
    const served = await person('Alone', 40);
    await prisma.officeRecord.create({ data: { moduleId: seniorId, personKey: served.personKey, data: {} } });
    const r = await reach(getPrismaForRole('admin'));
    expect(r.households).toBe(2);
    expect(r.byPrograms).toEqual([{ bucket: '0', households: 1 }, { bucket: '1', households: 1 }, { bucket: '2-3', households: 0 }, { bucket: '4+', households: 0 }]);
    expect(r.vulnerableNone).toBe(1);
  });

  it('estimates months to close a gap, and reports data quality per office', async () => {
    await person('Unserved', 70);
    const p = (await pace(getPrismaForRole('admin'))).find((x) => x.id === ruleId)!;
    expect([p.gap, p.perMonth, p.months]).toEqual([1, 0, null]);
    const sample = await person('Sample', 65);
    await prisma.officeRecord.create({ data: { moduleId: seniorId, personKey: sample.personKey, data: { _sample: true } } });
    const q = (await quality(getPrismaForRole('admin'))).find((x) => x.office.includes('Social Welfare') || x.office === 'cswd')!;
    expect([q.records, q.sample]).toEqual([1, 1]);
  });

  it('overview attention counts agree with the pages they open', async () => {
    await person('Unserved', 70);
    await person('Also', 75);
    await prisma.dataRequest.create({ data: { requesterName: 'T', kind: 'access', receivedOn: new Date(Date.now() - 3 * 86400000) } });
    try {
      const client = getPrismaForRole('admin');
      const a = await cityAttention(client);
      const rule = toGapRule(await prisma.programGapRule.findUniqueOrThrow({ where: { id: ruleId } }));
      expect(a.gaps.notServed).toBe((await countGap(client, rule, {})).total);
      expect(a.gaps.notServed).toBe(2);
      expect(a.privacy).toEqual({ open: 1, oldestDays: 3 });
      expect(a.disaster.relief).toBeNull();
    } finally {
      await prisma.dataRequest.deleteMany();
    }
  });
});
