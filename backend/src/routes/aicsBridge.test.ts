import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { splitMemberName } from '../services/aicsBridge';
import { setSetting } from '../services/config';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const KEY = 'test-integration-key';

// A stand-in for the AICS Integration API (integrations/aics/openapi.yaml):
// the same paths, key check and paging, serving whatever the test puts in.
type FakeRelease = {
  id: string; caseNumber: string; clientId: string; assistanceType: string; amount: number | null; releasedAt: string;
  beneficiaryIsClient: boolean; beneficiaryName: string | null; beneficiaryRelationship: string | null; withdrawn: boolean; updatedAt: string;
  deceased?: { name: string; age: number | null; sex: string | null; civilStatus: string | null; dateOfDeath: string | null } | null;
};
const aics = {
  releases: [] as FakeRelease[],
  clients: new Map<string, Record<string, unknown>>(),
  calls: [] as string[],
  // How many of the next calls to refuse with 429 (the per-minute limit).
  refuse: 0,
};

function fakeAics() {
  const app = express();
  app.use((req, res, next) => {
    aics.calls.push(req.originalUrl);
    if (req.get('x-integration-key') !== KEY) { res.status(401).json({ message: 'Invalid integration key' }); return; }
    if (aics.refuse > 0) { aics.refuse--; res.status(429).json({ message: 'Too many requests' }); return; }
    next();
  });
  app.get('/api/integration/v1/releases', (req, res) => {
    const since = typeof req.query.updatedSince === 'string' ? req.query.updatedSince : '';
    const start = typeof req.query.cursor === 'string' ? Number(req.query.cursor) : 0;
    const all = aics.releases.filter((r) => r.updatedAt >= since).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    // Pages of two, so the paging loop is exercised.
    res.json({ items: all.slice(start, start + 2), nextCursor: start + 2 < all.length ? String(start + 2) : null });
  });
  app.get('/api/integration/v1/clients', (req, res) => {
    const since = typeof req.query.updatedSince === 'string' ? req.query.updatedSince : '';
    res.json({ items: [...aics.clients.values()].filter((c) => String(c.updatedAt ?? '') >= since), nextCursor: null });
  });
  app.get('/api/integration/v1/clients/:id', (req, res) => {
    const client = aics.clients.get(req.params.id);
    if (!client) { res.status(404).json({ message: 'Client not found' }); return; }
    res.json(client);
  });
  return app;
}

const LINDA = '11111111-1111-4111-8111-111111111111';
const JUAN = '22222222-2222-4222-8222-222222222222';
const NOBDATE = '33333333-3333-4333-8333-333333333333';
const release = (n: number, clientId: string, extra: Partial<FakeRelease> = {}): FakeRelease => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`, caseNumber: `MD-AICS-VGN-000${n}`, clientId, assistanceType: 'medicine', amount: 1000 * n,
  releasedAt: `2026-09-0${n}T03:00:00.000Z`, beneficiaryIsClient: true, beneficiaryName: null, beneficiaryRelationship: null, withdrawn: false,
  updatedAt: `2026-09-0${n}T03:00:00.000Z`, ...extra,
});

describe('pulling released assistance from AICS', () => {
  const app = createApp();
  let server: Server;
  let moduleId = '';
  let createdOffice = '';
  let brgy = { code: '', name: '' };

  beforeAll(async () => {
    server = fakeAics().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    process.env.AICS_BRIDGE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integration/v1/`;
    process.env.AICS_BRIDGE_KEY = KEY;
    process.env.AICS_BRIDGE_RATE_LIMIT_WAIT_MS = '10';

    // The AICS program: the seeded test database has none, a demo database does.
    let mod = await prisma.officeModule.findFirst({ where: { slug: 'aics' } });
    if (!mod) {
      const office = await prisma.office.create({ data: { name: 'AICS Bridge Test Office', slug: `aics_bridge_test_${Date.now()}` } });
      createdOffice = office.id;
      mod = await prisma.officeModule.create({
        data: {
          officeId: office.id, name: 'AICS Assistance', slug: 'aics', givesAssistance: true, assistanceAmountKey: 'amount_granted_php',
          formFields: { create: [
            { key: 'assistance_type', label: 'Type', fieldType: 'SELECT', options: ['Medicine', 'Medical', 'Hospital Bill', 'Burial', 'Eyeglasses'] },
            { key: 'amount_granted_php', label: 'Amount Granted (PHP)', fieldType: 'NUMBER' },
            { key: 'date_released', label: 'Date Released', fieldType: 'DATE' },
            { key: 'voucher_control_no', label: 'Voucher No.', fieldType: 'TEXT' },
            { key: 'patient_deceased_name', label: 'Patient / Deceased Name', fieldType: 'TEXT' },
          ] },
        },
      });
    }
    moduleId = mod.id;
    brgy = await prisma.barangay.findFirstOrThrow({ where: { code: { startsWith: 'VIG-' } }, orderBy: { code: 'asc' } });
  });

  beforeEach(async () => {
    await prisma.officeRecord.deleteMany({ where: { moduleId } });
    await resetDb();
    await setSetting('AICS_BRIDGE_STATE', '');
    aics.calls.length = 0;
    aics.refuse = 0;
    aics.clients.clear();
    aics.clients.set(LINDA, { id: LINDA, lastName: 'PONS', firstName: 'LINDA', middleName: 'DEJAYCO', dateOfBirth: '1960-07-18', sex: 'Female', civilStatus: 'Single', barangay: brgy.name.replace(/\s*\(.*\)/, '').toUpperCase() });
    aics.clients.set(JUAN, { id: JUAN, lastName: 'REYES', firstName: 'JUAN', middleName: null, dateOfBirth: '1985-03-02', sex: 'Male', civilStatus: null, barangay: 'Somewhere Else' });
    aics.clients.set(NOBDATE, { id: NOBDATE, lastName: 'CRUZ', firstName: 'ANA', middleName: null, dateOfBirth: null, sex: null, civilStatus: null, barangay: null });
    aics.releases = [release(1, LINDA), release(2, LINDA, { assistanceType: 'hospital' }), release(3, JUAN, { assistanceType: 'burial', beneficiaryIsClient: false, beneficiaryName: 'Pedro Reyes' })];
  });

  afterAll(async () => {
    delete process.env.AICS_BRIDGE_URL;
    delete process.env.AICS_BRIDGE_KEY;
    delete process.env.AICS_BRIDGE_RATE_LIMIT_WAIT_MS;
    await new Promise((resolve) => server.close(resolve));
    await prisma.officeRecord.deleteMany({ where: { moduleId } });
    if (createdOffice) {
      await prisma.officeFormField.deleteMany({ where: { moduleId } });
      await prisma.officeModule.deleteMany({ where: { officeId: createdOffice } });
      await prisma.office.delete({ where: { id: createdOffice } });
    }
    await setSetting('AICS_BRIDGE_STATE', '');
    await prisma.$disconnect();
  });

  const records = () => prisma.officeRecord.findMany({ where: { moduleId }, orderBy: { createdAt: 'asc' }, include: { citizen: true } });

  it('adds each release once: an existing citizen is matched, a new one is created, the record is dated the release day', async () => {
    const existing = await prisma.citizen.create({ data: { personLname: 'PONS', personFname: 'LINDA', personBdate: new Date('1960-07-18') } });
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.status).toBe(200);
    expect(res.body.lastResult).toEqual({ received: 3, added: 3, newCitizens: 1, citizensFilledIn: 1, sentToReview: 0, withdrawn: 0, alreadyHere: 0, skippedNoBirthdate: 0, householdMembersAdded: 0, householdMembersToCheck: 0, householdMembersSkipped: 0, updated: 0, deathsRecorded: 0, programRecordsAdded: 0 });
    expect(res.body).toMatchObject({ configured: true, since: '2026-09-03T03:00:00.000Z', lastError: null });

    const rows = await records();
    expect(rows.map((r) => r.personKey)).toEqual([existing.personKey, existing.personKey, rows[2]?.personKey]);
    expect(rows[0]?.createdAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(rows[1]?.data).toMatchObject({ _aics_case_id: release(2, LINDA).id, _source: 'aics', assistance_type: 'Hospital Bill', amount_granted_php: 2000, date_released: '2026-09-02', voucher_control_no: 'MD-AICS-VGN-0002' });
    expect(rows[2]?.data).toMatchObject({ assistance_type: 'Burial', patient_deceased_name: 'PEDRO REYES' });
    // The new citizen: created from the AICS client; a barangay the registry does not know is left empty.
    expect(rows[2]?.citizen).toMatchObject({ personLname: 'REYES', personFname: 'JUAN', personSex: 'M', personBrgyCode: null });

    // Pulling again brings nothing new, and asks only for what changed since.
    aics.calls.length = 0;
    const again = await agent.post('/admin/aics-bridge/sync');
    expect(again.body.lastResult).toMatchObject({ received: 1, added: 0, alreadyHere: 1 });
    expect(aics.calls[0]).toContain('updatedSince=2026-09-03T03%3A00%3A00.000Z');
    expect(await prisma.officeRecord.count({ where: { moduleId } })).toBe(3);
  });

  it('fills the empty details of a citizen already here, and leaves what is there alone', async () => {
    const existing = await prisma.citizen.create({ data: { personLname: 'PONS', personFname: 'LINDA', personBdate: new Date('1960-07-18'), personCivilStatus: 'MARRIED' } });
    aics.clients.set(LINDA, { ...aics.clients.get(LINDA), occupation: 'Vendor' });
    aics.releases = [release(1, LINDA)];
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ added: 1, newCitizens: 0, citizensFilledIn: 1 });
    expect(await prisma.citizen.findUnique({ where: { personKey: existing.personKey } })).toMatchObject({
      personMname: 'DEJAYCO', personSex: 'F', personBrgyCode: brgy.code, personOccupation: 'VENDOR', personCivilStatus: 'MARRIED',
    });
  });

  it("makes the client's family composition their household, once, and leaves other households alone", async () => {
    // Already a member of somebody else's household: stays there.
    const otherHead = await prisma.citizen.create({ data: { personLname: 'RAMOS', personFname: 'CARLOS', personBdate: new Date('1950-01-01'), personIsHead: true } });
    const elsewhere = await prisma.citizen.create({ data: { personLname: 'PONS', personFname: 'MARIO', personBdate: new Date('1990-05-05'), personParentKey: otherHead.personKey, personRelationToHead: 'Boarder' } });
    // Already a citizen, in no household: linked, not duplicated.
    const known = await prisma.citizen.create({ data: { personLname: 'PONS', personFname: 'GEOZETTE', personBdate: new Date('1986-02-14') } });
    aics.clients.set(LINDA, { ...aics.clients.get(LINDA), updatedAt: '2026-09-01T00:00:00.000Z', familyMembers: [
      { name: 'Geozette D. Pons', age: 40, dateOfBirth: '1986-02-14', relationship: 'daughter', sex: 'Female', occupation: 'Teacher' },
      { name: 'Pedro Dela Cruz Jr.', age: 12, dateOfBirth: '2014-03-09', relationship: 'GRANDSON', sex: 'Male', occupation: null },
      { name: 'Mario Pons', age: 36, dateOfBirth: '1990-05-05', relationship: 'Son', sex: 'Male', occupation: null },
      { name: 'Nena Pons', age: 70, dateOfBirth: null, relationship: 'Sister', sex: 'Female', occupation: null },
    ] });
    aics.releases = [release(1, LINDA)];
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ added: 1, householdMembersAdded: 3, householdMembersToCheck: 1, householdMembersSkipped: 1 });

    const head = await prisma.citizen.findFirstOrThrow({ where: { personLname: 'PONS', personFname: 'LINDA' } });
    expect(head.personIsHead).toBe(true);
    const members = await prisma.citizen.findMany({ where: { personParentKey: head.personKey }, orderBy: { personBdate: 'asc' } });
    expect(members.map((m) => [m.personKey === known.personKey, m.personLname, m.personFname, m.personRelationToHead, m.personSex, m.personBrgyCode])).toEqual([
      [true, 'PONS', 'GEOZETTE', 'Daughter', 'F', brgy.code],
      [false, 'DELA CRUZ', 'PEDRO JR.', 'Grandson', 'M', brgy.code],
      // No date of birth in AICS: added all the same.
      [false, 'PONS', 'NENA', 'Sister', 'F', brgy.code],
    ]);
    expect(members[2]?.personBdate).toBeNull();
    expect(members[0]?.personOccupation).toBe('TEACHER');
    expect((await prisma.citizen.findUniqueOrThrow({ where: { personKey: elsewhere.personKey } })).personParentKey).toBe(otherHead.personKey);

    // A family member AICS adds later joins on the next pull, and a date of birth AICS
    // gets later is filled in; nobody is added twice.
    aics.clients.set(LINDA, { ...aics.clients.get(LINDA), updatedAt: '2026-09-20T00:00:00.000Z', familyMembers: [
      ...(aics.clients.get(LINDA)?.familyMembers as Array<{ name: string }>).map((m) => (m.name === 'Nena Pons' ? { ...m, dateOfBirth: '1956-06-06' } : m)),
      { name: 'Rosa Pons', age: 1, dateOfBirth: '2025-08-01', relationship: 'Granddaughter', sex: 'Female', occupation: null },
    ] });
    const again = await agent.post('/admin/aics-bridge/sync');
    expect(again.body.lastResult).toMatchObject({ added: 0, householdMembersAdded: 1 });
    expect(await prisma.citizen.count({ where: { personParentKey: head.personKey } })).toBe(4);
    expect((await prisma.citizen.findUniqueOrThrow({ where: { personKey: members[2]!.personKey } })).personBdate?.toISOString().slice(0, 10)).toBe('1956-06-06');
    expect(await prisma.citizen.count({ where: { personLname: 'PONS', personFname: 'GEOZETTE' } })).toBe(1);
  });

  it('puts a client AICS marked as senior, PWD or solo parent on that CSWD list, once, and never back on after CSWD removed them', async () => {
    const office = await prisma.office.create({ data: { name: 'Marks Test Office', slug: `marks_test_${Date.now()}` } });
    const made: string[] = [];
    const program = async (slug: string) => {
      const existing = await prisma.officeModule.findFirst({ where: { slug }, orderBy: { createdAt: 'asc' } });
      if (existing) return existing.id;
      const created = await prisma.officeModule.create({ data: { officeId: office.id, name: slug, slug } });
      made.push(created.id);
      return created.id;
    };
    const [senior, pwd, solo] = [await program('senior_citizen'), await program('pwd'), await program('solo_parent')];
    const on = (moduleId: string) => prisma.officeRecord.findMany({ where: { moduleId, data: { path: ['_source'], equals: 'aics' } }, include: { citizen: true } });
    try {
      // Linda (born 1960) is a senior and a PWD. Juan (born 1985) is ticked senior by mistake, and is a solo parent.
      aics.clients.set(LINDA, { ...aics.clients.get(LINDA), updatedAt: '2026-09-01T00:00:00.000Z', isSenior: true, isPwd: true, isSoloParent: false, is4ps: true });
      aics.clients.set(JUAN, { ...aics.clients.get(JUAN), updatedAt: '2026-09-01T00:00:00.000Z', isSenior: true, isPwd: false, isSoloParent: true, is4ps: false });
      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.post('/admin/aics-bridge/sync');
      expect(res.body.lastResult).toMatchObject({ added: 3, programRecordsAdded: 3 });
      expect((await on(senior)).map((r) => r.citizen?.personFname)).toEqual(['LINDA']);
      expect((await on(pwd)).map((r) => r.citizen?.personFname)).toEqual(['LINDA']);
      expect((await on(solo)).map((r) => r.citizen?.personFname)).toEqual(['JUAN']);

      // CSWD takes Linda off the PWD list; pulling everything again adds nothing.
      await prisma.officeRecord.updateMany({ where: { moduleId: pwd, data: { path: ['_source'], equals: 'aics' } }, data: { isArchived: true } });
      await setSetting('AICS_BRIDGE_STATE', '');
      const again = await agent.post('/admin/aics-bridge/sync');
      expect(again.body.lastResult).toMatchObject({ programRecordsAdded: 0 });
      expect([(await on(senior)).length, (await on(pwd)).length, (await on(solo)).length]).toEqual([1, 1, 1]);
    } finally {
      await prisma.officeRecord.deleteMany({ where: { moduleId: { in: [senior, pwd, solo] }, data: { path: ['_source'], equals: 'aics' } } });
      await prisma.officeModule.deleteMany({ where: { id: { in: made } } });
      await prisma.office.delete({ where: { id: office.id } });
    }
  });

  it('records the death behind a burial release in Civil Registry, under the name, once', async () => {
    let death = await prisma.officeModule.findFirst({ where: { slug: 'death' } });
    let madeOffice = '';
    if (!death) {
      const office = await prisma.office.create({ data: { name: 'Death Test Office', slug: `death_test_${Date.now()}` } });
      madeOffice = office.id;
      death = await prisma.officeModule.create({ data: { officeId: office.id, name: 'Death', slug: 'death', requiresCitizenLink: false, formFields: { create: [{ key: 'date_of_death', label: 'Date of Death', fieldType: 'DATE' }, { key: 'registry_no', label: 'Registry No.', fieldType: 'TEXT' }] } } });
    }
    const deathId = death.id;
    const deathRecords = () => prisma.officeRecord.findMany({ where: { moduleId: deathId, data: { path: ['_source'], equals: 'aics' } }, orderBy: { createdAt: 'asc' } });
    try {
      // A citizen with the same name stays alive: a name alone is not enough to mark someone deceased.
      const namesake = await prisma.citizen.create({ data: { personLname: 'REYES', personFname: 'PEDRO', personBdate: new Date('1950-01-01'), personIsHead: true } });
      const pedro = { name: 'Pedro R. Reyes', age: 76, sex: 'Male', civilStatus: 'Married', dateOfDeath: '2026-08-30' };
      aics.releases = [
        release(1, LINDA),
        release(3, JUAN, { assistanceType: 'burial', beneficiaryIsClient: false, beneficiaryName: 'Pedro Reyes', deceased: pedro }),
      ];
      const agent = await loginAgent(app, 'admin.demo');
      const res = await agent.post('/admin/aics-bridge/sync');
      expect(res.body.lastResult).toMatchObject({ added: 2, deathsRecorded: 1 });
      const rows = await deathRecords();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ personKey: null, unresolvedPerson: { lname: 'REYES', fname: 'PEDRO' }, data: { _aics_case_id: release(3, JUAN).id, date_of_death: '2026-08-30' } });
      expect((await prisma.citizen.findUniqueOrThrow({ where: { personKey: namesake.personKey } })).personIsHead).toBe(true);

      // Pulled again from the start: not recorded twice.
      await setSetting('AICS_BRIDGE_STATE', '');
      const again = await agent.post('/admin/aics-bridge/sync');
      expect(again.body.lastResult).toMatchObject({ deathsRecorded: 0 });
      expect(await deathRecords()).toHaveLength(1);

      // Cancelled in AICS before Civil Registry acted on it: the death record goes too.
      aics.releases = [release(3, JUAN, { assistanceType: 'burial', deceased: pedro, withdrawn: true, updatedAt: '2026-09-09T00:00:00.000Z' })];
      await agent.post('/admin/aics-bridge/sync');
      expect((await deathRecords())[0]?.isArchived).toBe(true);
    } finally {
      await prisma.officeRecord.deleteMany({ where: { moduleId: deathId, data: { path: ['_source'], equals: 'aics' } } });
      if (madeOffice) {
        await prisma.officeFormField.deleteMany({ where: { moduleId: deathId } });
        await prisma.officeModule.delete({ where: { id: deathId } });
        await prisma.office.delete({ where: { id: madeOffice } });
      }
    }
  });

  it('does not record a death Civil Registry already has', async () => {
    const death = await prisma.officeModule.findFirst({ where: { slug: 'death' } });
    if (!death) return; // the seeded test database has the Death program
    const own = await prisma.officeRecord.create({ data: { moduleId: death.id, unresolvedPerson: { lname: 'Reyes', fname: 'Pedro' }, data: { registry_no: '2026-101', date_of_death: '2026-08-30' } } });
    aics.releases = [release(3, JUAN, { assistanceType: 'burial', deceased: { name: 'Pedro R. Reyes', age: 76, sex: 'Male', civilStatus: null, dateOfDeath: '2026-08-30' } })];
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ added: 1, deathsRecorded: 0 });
    expect(await prisma.officeRecord.count({ where: { moduleId: death.id, data: { path: ['_source'], equals: 'aics' } } })).toBe(0);
    await prisma.officeRecord.delete({ where: { id: own.id } });
  });

  it('adds a family member whose name is close to somebody else\'s, for the administrator to check', async () => {
    const close = await prisma.citizen.create({ data: { personLname: 'PONZ', personFname: 'GEOZETTE', personBdate: new Date('1986-02-14') } });
    aics.clients.set(LINDA, { ...aics.clients.get(LINDA), familyMembers: [{ name: 'Geozette Pons', age: 40, dateOfBirth: '1986-02-14', relationship: 'Daughter', sex: 'Female', occupation: null }] });
    aics.releases = [release(1, LINDA)];
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ householdMembersAdded: 1, householdMembersToCheck: 1, householdMembersSkipped: 0 });
    expect((await prisma.citizen.findUniqueOrThrow({ where: { personKey: close.personKey } })).personParentKey).toBeNull();
    const pairs = (await agent.get('/admin/duplicate-citizens')).body.items as Array<{ reason: string; a: { lname: string }; b: { lname: string } }>;
    expect(pairs.map((p) => [p.reason, ...[p.a.lname, p.b.lname].sort()])).toEqual([['similar_name', 'PONS', 'PONZ']]);
  });

  it('corrects a record when AICS corrects the release', async () => {
    aics.releases = [release(1, LINDA)];
    const agent = await loginAgent(app, 'admin.demo');
    await agent.post('/admin/aics-bridge/sync');
    aics.releases = [release(1, LINDA, { amount: 2500, assistanceType: 'medical', updatedAt: '2026-09-10T00:00:00.000Z' })];
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ received: 1, added: 0, alreadyHere: 1, updated: 1 });
    const rows = await records();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ amount_granted_php: 2500, assistance_type: 'Medical', voucher_control_no: 'MD-AICS-VGN-0001' });
    // Unchanged since: nothing to correct.
    expect((await agent.post('/admin/aics-bridge/sync')).body.lastResult).toMatchObject({ alreadyHere: 1, updated: 0 });
  });

  it('splits a family member name into given and family name', () => {
    const linda = { lastName: 'PONS', middleName: 'DEJAYCO' };
    expect(splitMemberName('Maria Clara Pons', linda)).toEqual({ lname: 'PONS', fname: 'MARIA CLARA' });
    expect(splitMemberName('Jose R. Dejayco', linda)).toEqual({ lname: 'DEJAYCO', fname: 'JOSE' });
    expect(splitMemberName('Ana De la Cruz', linda)).toEqual({ lname: 'DE LA CRUZ', fname: 'ANA' });
    expect(splitMemberName('REYES, JUAN', linda)).toEqual({ lname: 'REYES', fname: 'JUAN' });
    expect(splitMemberName('Pons', linda)).toBeNull();
  });

  it("matches the AICS barangay name to the registry's code", async () => {
    aics.releases = [release(1, LINDA)];
    const agent = await loginAgent(app, 'admin.demo');
    await agent.post('/admin/aics-bridge/sync');
    expect((await records())[0]?.citizen?.personBrgyCode).toBe(brgy.code);
  });

  it('archives a release that AICS withdrew, and skips a client with no date of birth', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    await agent.post('/admin/aics-bridge/sync');
    aics.releases = [
      release(2, LINDA, { withdrawn: true, updatedAt: '2026-09-05T00:00:00.000Z' }),
      release(4, NOBDATE, { updatedAt: '2026-09-06T00:00:00.000Z' }),
    ];
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ received: 2, withdrawn: 1, skippedNoBirthdate: 1, added: 0 });
    const rows = await records();
    expect(rows.filter((r) => r.isArchived).map((r) => (r.data as { _aics_case_id: string })._aics_case_id)).toEqual([release(2, LINDA).id]);
  });

  it('sends a close-but-not-exact name to Duplicate review instead of guessing, once', async () => {
    await prisma.citizen.create({ data: { personLname: 'PONZ', personFname: 'LINDA', personBdate: new Date('1960-07-18') } });
    aics.releases = [release(1, LINDA)];
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ sentToReview: 1, added: 0 });
    expect(await prisma.officeRecord.count({ where: { moduleId } })).toBe(0);

    await setSetting('AICS_BRIDGE_STATE', '');
    const again = await agent.post('/admin/aics-bridge/sync');
    expect(again.body.lastResult).toMatchObject({ sentToReview: 0, alreadyHere: 1 });
    expect(await prisma.duplicateReviewQueueItem.count({ where: { moduleId } })).toBe(1);
  });

  it("stays inside AICS's per-minute limit: clients come by the page on a first pull, and a refused call is tried again", async () => {
    aics.refuse = 2;
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.post('/admin/aics-bridge/sync');
    expect(res.body.lastResult).toMatchObject({ received: 3, added: 3 });
    expect(aics.calls.filter((url) => url.includes('/clients/'))).toEqual([]);

    // Later pulls look up only the clients of what is new.
    aics.releases = [release(4, JUAN, { updatedAt: '2026-09-06T00:00:00.000Z' })];
    aics.calls.length = 0;
    await agent.post('/admin/aics-bridge/sync');
    expect(aics.calls.filter((url) => url.includes('/clients/'))).toEqual([`/api/integration/v1/clients/${JUAN}`]);
  });

  it('reports a failure and keeps its place when AICS refuses the key', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    await agent.post('/admin/aics-bridge/sync');
    process.env.AICS_BRIDGE_KEY = 'wrong';
    const res = await agent.post('/admin/aics-bridge/sync');
    process.env.AICS_BRIDGE_KEY = KEY;
    expect(res.status).toBe(502);
    expect(res.body.error.message).toContain('AICS answered 401');
    const status = await agent.get('/admin/aics-bridge');
    expect(status.body).toMatchObject({ since: '2026-09-03T03:00:00.000Z', lastError: expect.stringContaining('401') });
  });

  it('is off without the address and key, and for the administrator only', async () => {
    const saved = process.env.AICS_BRIDGE_URL;
    delete process.env.AICS_BRIDGE_URL;
    const agent = await loginAgent(app, 'admin.demo');
    expect((await agent.get('/admin/aics-bridge')).body.configured).toBe(false);
    expect((await agent.post('/admin/aics-bridge/sync')).status).toBe(409);
    process.env.AICS_BRIDGE_URL = saved;

    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.get('/admin/aics-bridge')).status).toBe(403);
    expect((await staff.post('/admin/aics-bridge/sync')).status).toBe(403);
  });
});
