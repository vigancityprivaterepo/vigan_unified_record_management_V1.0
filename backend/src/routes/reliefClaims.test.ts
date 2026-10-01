import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';
import { normalizeEvent } from '../services/reliefClaims';

// A Relief Distribution module is added to the seeded Agriculture office
// (agri.demo) for this file only; the rule keys on the module slug.
describe('relief distribution: one claim per household per event', () => {
  const app = createApp();
  let officeId = '';
  let moduleId = '';
  const url = () => `/offices/${officeId}/modules/${moduleId}/records`;

  beforeAll(async () => {
    officeId = (await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } })).id;
    moduleId = (await prisma.officeModule.create({ data: { officeId, name: 'Relief Distribution', slug: 'relief_distribution' } })).id;
    await prisma.officeFormField.createMany({
      data: [
        { moduleId, key: 'event', label: 'Event', fieldType: 'TEXT', isRequired: true, sortOrder: 0 },
        { moduleId, key: 'distribution_date', label: 'Distribution date', fieldType: 'DATE', isRequired: true, sortOrder: 1 },
        { moduleId, key: 'distribution_site', label: 'Distribution site', fieldType: 'TEXT', isRequired: true, sortOrder: 2 },
      ],
    });
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.officeRecord.deleteMany({ where: { moduleId } });
    await prisma.officeFormField.deleteMany({ where: { moduleId } });
    await prisma.officeModule.delete({ where: { id: moduleId } });
    await prisma.$disconnect();
  });

  type Agent = Awaited<ReturnType<typeof loginAgent>>;
  const claim = (agent: Agent, person: { lname: string; fname: string; bdate: string }, event: string, site = 'City Hall Gym') =>
    agent
      .post(url())
      .field('lname', person.lname)
      .field('fname', person.fname)
      .field('bdate', person.bdate)
      .field('fields', JSON.stringify({ event, distribution_date: '2026-10-01', distribution_site: site }));

  it('normalizes event names loosely', () => {
    expect(normalizeEvent('Typhoon  Kristine.')).toBe('TYPHOON KRISTINE');
    expect(normalizeEvent(' typhoon-kristine ')).toBe('TYPHOON KRISTINE');
    expect(normalizeEvent('  ')).toBeNull();
  });

  it('refuses a second claim for the same event, allows a different event', async () => {
    const agent = await loginAgent(app, 'agri.demo');
    const juan = { lname: 'Relief', fname: 'Juan', bdate: '1970-05-05' };
    expect((await claim(agent, juan, 'Typhoon Kristine')).status).toBe(201);
    const again = await claim(agent, juan, 'TYPHOON  KRISTINE.', 'Another site');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RECEIVED');
    expect(again.body.error.message).toContain('CITY HALL GYM'); // intake stores free text uppercase
    expect((await claim(agent, juan, 'Flood October')).status).toBe(201);
    expect(await prisma.officeRecord.count({ where: { moduleId } })).toBe(2);
  });

  it('counts the whole household: a member cannot claim after the head did', async () => {
    const head = await prisma.citizen.create({ data: { personLname: 'HOUSE', personFname: 'HEAD', personBdate: new Date('1960-01-01'), personIsHead: true } });
    await prisma.citizen.create({ data: { personLname: 'HOUSE', personFname: 'MEMBER', personBdate: new Date('1990-02-02'), personParentKey: head.personKey } });
    const agent = await loginAgent(app, 'agri.demo');
    expect((await claim(agent, { lname: 'HOUSE', fname: 'HEAD', bdate: '1960-01-01' }, 'Typhoon Kristine')).status).toBe(201);
    const member = await claim(agent, { lname: 'HOUSE', fname: 'MEMBER', bdate: '1990-02-02' }, 'Typhoon Kristine');
    expect(member.status).toBe(409);
    expect(member.body.error.message).toContain('HOUSE, HEAD');
  });

  it('lets only one of two simultaneous claims through', async () => {
    await prisma.citizen.create({ data: { personLname: 'SAME', personFname: 'TIME', personBdate: new Date('1980-03-03') } });
    const a = await loginAgent(app, 'agri.demo');
    const b = await loginAgent(app, 'agri.demo');
    const person = { lname: 'SAME', fname: 'TIME', bdate: '1980-03-03' };
    const results = await Promise.all([claim(a, person, 'Typhoon Kristine'), claim(b, person, 'Typhoon Kristine')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});
