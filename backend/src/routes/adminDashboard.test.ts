import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createApp } from '../app';
import { env } from '../env';
import { decryptField } from '../lib/encryption';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actorUserId = '00000000-0000-0000-0000-000000000000';

async function seedModule(slug = 'test_office') {
  const office = await prisma.office.create({
    data: { name: 'Test Office', slug: `${slug}_${Date.now()}_${Math.random().toString(36).slice(2)}`, createdBy: actorUserId },
  });
  const officeModule = await prisma.officeModule.create({
    data: { officeId: office.id, name: 'Test Module', slug: 'default' },
  });
  return officeModule;
}

describe('/admin/citizens (search + 360 view)', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects non-admin roles', async () => {
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.get('/admin/citizens');
    expect(res.status).toBe(403);
  });

  it('search matches on last or first name, case-insensitively', async () => {
    await prisma.citizen.create({
      data: { personLname: 'Espiritu', personFname: 'Marlon', personBdate: new Date('1972-02-02') },
    });
    await prisma.citizen.create({
      data: { personLname: 'Cruz', personFname: 'Marlon', personBdate: new Date('1980-01-01') },
    });

    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/citizens').query({ q: 'espiritu' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].personLname).toBe('Espiritu');
  });

  it('360 view aggregates office records from every module for one person_key', async () => {
    const barangay = await prisma.barangay.upsert({
      where: { code: 'TEST-360' },
      create: { code: 'TEST-360', name: 'Test 360 Barangay' },
      update: {},
    });
    const citizen = await prisma.citizen.create({
      data: {
        personLname: 'Aquino',
        personFname: 'Herminia',
        personBdate: new Date('1955-03-03'),
        personBrgyCode: barangay.code,
      },
    });
    const seniorModule = await seedModule('senior');
    const farmerModule = await seedModule('farmer');
    await prisma.officeRecord.create({
      data: {
        moduleId: seniorModule.id,
        personKey: citizen.personKey,
        data: { commorbidity: 'Hypertension' },
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
    });
    await prisma.officeRecord.create({
      data: {
        moduleId: farmerModule.id,
        personKey: citizen.personKey,
        data: { locationOfFarm: 'Test Farm' },
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
    });

    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get(`/admin/citizens/${citizen.personKey}`);

    expect(res.status).toBe(200);
    expect(res.body.citizen.personLname).toBe('Aquino');
    expect(res.body.citizen.barangay.name).toBe('Test 360 Barangay');
    // Encrypted columns never leave the server as raw bytes; with nothing
    // on file, the decrypted value is just null (see the dedicated
    // encryption round-trip test further down for the "has a real value" case).
    expect(res.body.citizen.personSssEnc).toBeUndefined();
    expect(res.body.citizen.sss).toBeNull();

    expect(res.body.officeRecords).toHaveLength(2);
    const senior = res.body.officeRecords.find((r: { module: { id: string } }) => r.module.id === seniorModule.id);
    expect(senior.data.commorbidity).toBe('Hypertension');
    const farmer = res.body.officeRecords.find((r: { module: { id: string } }) => r.module.id === farmerModule.id);
    expect(farmer.data.locationOfFarm).toBe('Test Farm');
  });

  it('404s for an unknown person_key', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/citizens/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('/admin/households', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('groups citizens by person_parent_key / person_sub_parent_key', async () => {
    const head = await prisma.citizen.create({
      data: { personLname: 'Domingo', personFname: 'Ramon', personBdate: new Date('1955-01-01'), personIsHead: true },
    });
    const child = await prisma.citizen.create({
      data: {
        personLname: 'Domingo',
        personFname: 'Elena',
        personBdate: new Date('1980-01-01'),
        personParentKey: head.personKey,
        personRelationToHead: 'Daughter',
      },
    });
    const grandchild = await prisma.citizen.create({
      data: {
        personLname: 'Domingo',
        personFname: 'Nico',
        personBdate: new Date('2010-01-01'),
        personParentKey: head.personKey,
        personSubParentKey: child.personKey,
        personRelationToHead: 'Grandchild',
      },
    });

    const agent = await loginAgent(app, 'admin.demo');

    const listRes = await agent.get('/admin/households');
    expect(listRes.status).toBe(200);
    const household = listRes.body.items.find((h: { personKey: string }) => h.personKey === head.personKey);
    expect(household).toBeTruthy();
    expect(household.memberCount).toBe(3); // head + child + grandchild

    const detailRes = await agent.get(`/admin/households/${head.personKey}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.head.personKey).toBe(head.personKey);
    const memberKeys = detailRes.body.members.map((m: { personKey: string }) => m.personKey).sort();
    expect(memberKeys).toEqual([child.personKey, grandchild.personKey].sort());

    const grandchildRow = detailRes.body.members.find((m: { personKey: string }) => m.personKey === grandchild.personKey);
    expect(grandchildRow.personSubParentKey).toBe(child.personKey);
  });

  it('finds a household by a full name typed either way round, for the head or a member', async () => {
    const head = await prisma.citizen.create({
      data: { personLname: 'Domingo', personFname: 'Ramon', personBdate: new Date('1955-01-01'), personIsHead: true },
    });
    await prisma.citizen.create({
      data: { personLname: 'Dela Cruz', personFname: 'Elena', personBdate: new Date('1980-01-01'), personParentKey: head.personKey, personRelationToHead: 'Daughter' },
    });
    const agent = await loginAgent(app, 'admin.demo');
    const found = async (q: string) => (await agent.get('/admin/households').query({ q })).body.items.map((h: { personKey: string }) => h.personKey);

    for (const q of ['DOMINGO, RAMON', 'ramon domingo', 'Domingo', 'Dela Cruz, Elena', 'elena dela cruz']) {
      expect(await found(q), q).toEqual([head.personKey]);
    }
    expect(await found('Domingo, Pedro')).toEqual([]);
  });

  it('404s for a person_key that is not a household head', async () => {
    const notAHead = await prisma.citizen.create({
      data: { personLname: 'X', personFname: 'Y', personBdate: new Date('2000-01-01') },
    });
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get(`/admin/households/${notAHead.personKey}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/citizens/:personKey/government-ids (encryption at rest)', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('encrypts on write, decrypts correctly on the 360 view, and is unreadable as raw bytes via direct SQL', async () => {
    const citizen = await prisma.citizen.create({
      data: { personLname: 'Reyes', personFname: 'Delfin', personBdate: new Date('1960-01-01') },
    });

    const agent = await loginAgent(app, 'admin.demo');
    const patchRes = await agent
      .patch(`/admin/citizens/${citizen.personKey}/government-ids`)
      .send({ sss: '34-1234567-8', gsis: 'GSIS-9876', philhealth: 'PH-5555-1111' });
    expect(patchRes.status).toBe(204);

    // The app itself decrypts correctly.
    const viewRes = await agent.get(`/admin/citizens/${citizen.personKey}`);
    expect(viewRes.body.citizen.sss).toBe('34-1234567-8');
    expect(viewRes.body.citizen.gsis).toBe('GSIS-9876');
    expect(viewRes.body.citizen.philhealth).toBe('PH-5555-1111');

    // Raw bytes in Postgres are genuinely ciphertext, not plaintext with a
    // fig-leaf encoding -- checked directly with `pg`, no Prisma, as the
    // migration-owner superuser (the strongest DB-level read access that
    // exists), which is exactly what "confirmed unreadable via direct psql
    // SELECT without the app-layer key" means: even the highest-privileged
    // possible database session can't recover the value without the
    // encryption_key secret, because that key was never given to Postgres.
    const rawClient = new Client({ connectionString: env.databaseUrl });
    await rawClient.connect();
    try {
      const raw = await rawClient.query(
        'SELECT person_sss_enc, person_gsis_enc, person_philhealth_enc FROM "Citizen" WHERE person_key = $1',
        [citizen.personKey],
      );
      const row = raw.rows[0];
      const rawSss: Buffer = row.person_sss_enc;
      expect(rawSss).toBeInstanceOf(Buffer);
      expect(rawSss.toString('utf8')).not.toContain('34-1234567-8');
      expect(rawSss.toString('base64')).not.toContain('34-1234567-8');

      // And it's real authenticated encryption, not obfuscation: decrypting
      // those exact same bytes with the wrong key fails closed.
      expect(() => decryptField(rawSss, 'a-completely-wrong-key')).toThrow();
      // ...but with the actual key (what the running app has), it recovers
      // the original value -- proving the raw bytes really are this
      // citizen's SSS, not garbage that merely fails to decrypt.
      expect(decryptField(rawSss, env.encryptionKey)).toBe('34-1234567-8');
    } finally {
      await rawClient.end();
    }
  });

  it('rejects non-admin roles', async () => {
    const citizen = await prisma.citizen.create({
      data: { personLname: 'X', personFname: 'Y', personBdate: new Date('2000-01-01') },
    });
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.patch(`/admin/citizens/${citizen.personKey}/government-ids`).send({ sss: '123' });
    expect(res.status).toBe(403);
  });

  it('404s for an unknown person_key', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent
      .patch('/admin/citizens/00000000-0000-0000-0000-000000000000/government-ids')
      .send({ sss: '123' });
    expect(res.status).toBe(404);
  });
});
