import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { getPrismaForRole } from '../lib/prismaByRole';
import { resetDb } from '../testUtils/resetDb';
import { listVulnerable, reliefEvents, summarize } from './disasterLists';

// Seeded: pwd, solo_parent, death. The seed has no prenatal/evacuees, so a
// test office gets those (randomized office slug, same as other tests).
describe('disaster lists', () => {
  const ids: Record<string, string> = {};
  const yearsAgo = (y: number, days = 1) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() - days); return d; };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

  async function moduleId(slug: string): Promise<string> {
    const found = await prisma.officeModule.findFirst({ where: { slug } });
    if (found) return found.id;
    const office = await prisma.office.create({ data: { name: `Test ${randomUUID().slice(0, 8)}`, slug: `test_${randomUUID().slice(0, 8)}` } });
    return (await prisma.officeModule.create({ data: { officeId: office.id, name: slug, slug } })).id;
  }
  async function person(lname: string, age: number, records: Array<[string, Record<string, unknown>]> = []) {
    const c = await prisma.citizen.create({ data: { personLname: lname, personFname: 'T', personBdate: yearsAgo(age), personSex: 'F' }, select: { personKey: true } });
    for (const [slug, data] of records) await prisma.officeRecord.create({ data: { moduleId: ids[slug]!, personKey: c.personKey, data: data as object } });
    return c.personKey;
  }

  beforeAll(async () => {
    for (const slug of ['pwd', 'solo_parent', 'death', 'prenatal', 'evacuees', 'relief_distribution']) ids[slug] = await moduleId(slug);
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('flags seniors, young children, PWD, pregnancy and solo parents, and leaves out everyone else and the deceased', async () => {
    await person('Senior', 60);
    await person('Adult', 59);
    await person('Child', 4);
    await person('Five', 5);
    await person('Disabled', 30, [['pwd', {}]]);
    await person('Expecting', 28, [['prenatal', { expected_delivery_date: daysFromNow(60) }]]);
    await person('Delivered', 28, [['prenatal', { expected_delivery_date: daysFromNow(-90) }]]);
    await person('Solo', 35, [['solo_parent', {}]]);
    await person('Deceased', 85, [['death', {}]]);
    const { items } = await listVulnerable(getPrismaForRole('admin'), {}, null);
    const byName = Object.fromEntries(items.map((p) => [p.name.split(',')[0], p.needs]));
    expect(byName).toEqual({ Senior: ['senior'], Child: ['young_child'], Disabled: ['pwd'], Expecting: ['pregnant'], Solo: ['solo_parent'] });
  });

  it('marks people still in an evacuation center, not those who returned home', async () => {
    await person('StillThere', 70, [['evacuees', { evacuation_center: 'City Hall Gym', returned_home: 'false', date_evacuated: daysFromNow(-1) }]]);
    await person('Returned', 72, [['evacuees', { evacuation_center: 'School', returned_home: 'true', date_evacuated: daysFromNow(-3) }]]);
    const client = getPrismaForRole('admin');
    const { items } = await listVulnerable(client, {}, null);
    expect(Object.fromEntries(items.map((p) => [p.name.split(',')[0], p.evacuationCenter]))).toEqual({ StillThere: 'City Hall Gym', Returned: null });
    const { totals } = await summarize(client, {});
    expect(totals.people).toBe(2);
    expect(totals.evacuatedNow).toBe(1);
    expect(totals.senior).toBe(2);
  });

  it('keeps an unlikely pregnancy on the list but flags it for checking', async () => {
    await person('Likely', 30, [['prenatal', { expected_delivery_date: daysFromNow(30) }]]);
    await person('Unlikely', 70, [['prenatal', { expected_delivery_date: daysFromNow(30) }]]);
    const { items } = await listVulnerable(getPrismaForRole('admin'), { category: 'pregnant' }, null);
    expect(Object.fromEntries(items.map((p) => [p.name.split(',')[0], p.pregnancyNeedsCheck]))).toEqual({ Likely: false, Unlikely: true });
  });

  it('marks whose household received relief for an event, matching event spellings loosely', async () => {
    const head = await person('Head', 70, [['relief_distribution', { event: 'Typhoon Kristine', distribution_date: '2026-10-01' }]]);
    const member = await prisma.citizen.create({ data: { personLname: 'Member', personFname: 'T', personBdate: yearsAgo(2), personParentKey: head } });
    await prisma.citizen.update({ where: { personKey: head }, data: { personIsHead: true } });
    await person('Unreached', 65);
    await person('OtherEvent', 66, [['relief_distribution', { event: 'Flood October' }]]);
    const client = getPrismaForRole('admin');
    const f = { event: 'TYPHOON  kristine.' };
    const { items } = await listVulnerable(client, f, null);
    expect(Object.fromEntries(items.map((p) => [p.name.split(',')[0], p.reliefReceived]))).toEqual({ Head: true, Member: true, Unreached: false, OtherEvent: false });
    expect(member.personKey).toBeTruthy();
    expect((await listVulnerable(client, { ...f, relief: 'not_received' }, null)).items.map((p) => p.name.split(',')[0]).sort()).toEqual(['OtherEvent', 'Unreached']);
    const { totals } = await summarize(client, f);
    expect([totals.reliefPeople, totals.reliefHouseholds]).toEqual([2, 1]);
    expect((await listVulnerable(client, {}, null)).items.every((p) => p.reliefReceived === null)).toBe(true);
    expect((await reliefEvents(client)).map((e) => e.event).sort()).toEqual(['FLOOD OCTOBER', 'TYPHOON KRISTINE']);
  });

  it('filters by need', async () => {
    await person('Senior', 66);
    await person('SeniorPwd', 67, [['pwd', {}]]);
    const { total, items } = await listVulnerable(getPrismaForRole('admin'), { category: 'pwd' }, null);
    expect(total).toBe(1);
    expect(items[0]?.needs).toEqual(['senior', 'pwd']);
  });
});
