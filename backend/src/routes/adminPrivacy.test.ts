import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

describe('privacy tools (/admin/privacy)', () => {
  const app = createApp();
  beforeEach(async () => {
    await resetDb();
    await prisma.dataRequest.deleteMany();
  });
  afterAll(async () => {
    await prisma.dataRequest.deleteMany();
    await prisma.$disconnect();
  });

  async function senior(lname: string) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 70);
    return prisma.citizen.create({ data: { personLname: lname, personFname: 'Test', personBdate: d }, select: { personKey: true } });
  }

  it("records who opened a profile and who saw the person on a disaster list, in that person's history", async () => {
    const { personKey } = await senior('Viewed');
    const other = await senior('Other');
    const admin = await loginAgent(app, 'admin.demo');
    expect((await admin.get(`/admin/citizens/${personKey}`)).status).toBe(200);
    expect((await admin.get('/admin/disaster-lists/people')).status).toBe(200);

    const res = await admin.get(`/admin/privacy/people/${personKey}/access`);
    expect(res.status).toBe(200);
    const whats = res.body.entries.map((e: { what: string }) => e.what);
    expect(whats).toContain('Opened the citizen profile');
    expect(whats).toContain('Saw this person in a Disaster list');
    expect(res.body.entries[0].who).toBe('Admin Demo');

    // The other person was on the list too, but nobody opened their profile.
    const otherWhats = (await admin.get(`/admin/privacy/people/${other.personKey}/access`)).body.entries.map((e: { what: string }) => e.what);
    expect(otherWhats).toEqual(['Saw this person in a Disaster list']);
  });

  it('logs a data request, closes it with a date, and reopening clears the date', async () => {
    const { personKey } = await senior('Requester');
    const admin = await loginAgent(app, 'admin.demo');
    expect((await admin.post('/admin/privacy/requests').send({ requesterName: 'Juan', kind: 'delete-everything', receivedOn: '2026-10-01' })).status).toBe(400);

    const created = await admin.post('/admin/privacy/requests').send({ requesterName: 'Juan Requester', personKey, kind: 'correction', details: 'Wrong birthdate', receivedOn: '2026-10-01' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'open', closedOn: null, receivedOn: '2026-10-01' });

    const done = await admin.patch(`/admin/privacy/requests/${created.body.id}`).send({ status: 'done', response: 'Corrected', closedOn: '2026-10-03' });
    expect(done.body).toMatchObject({ status: 'done', closedOn: '2026-10-03', response: 'Corrected' });
    const reopened = await admin.patch(`/admin/privacy/requests/${created.body.id}`).send({ status: 'open' });
    expect(reopened.body).toMatchObject({ status: 'open', closedOn: null });

    expect((await admin.get(`/admin/privacy/requests?personKey=${personKey}`)).body).toHaveLength(1);
    expect((await admin.get('/admin/privacy/requests?status=done')).body).toHaveLength(0);
  });

  it('counts exports per person in the monthly access report, and is admin only', async () => {
    const { personKey } = await senior('Exported');
    const admin = await loginAgent(app, 'admin.demo');
    await admin.get(`/admin/citizens/${personKey}`);
    await admin.get('/admin/disaster-lists/people.csv');
    const report = await admin.get(`/admin/privacy/access?month=${new Date().toISOString().slice(0, 7)}`);
    expect(report.status).toBe(200);
    const me = report.body.people.find((p: { who: string }) => p.who === 'Admin Demo');
    expect(me.exports).toBeGreaterThanOrEqual(1);
    // The profile view has no export marker; it must still count as a view.
    expect(me.views).toBeGreaterThanOrEqual(1);
    expect(report.body.exports[0]).toMatchObject({ what: 'Exported a Disaster list', who: 'Admin Demo', rows: 1 });

    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.get('/admin/privacy/access')).status).toBe(403);
  });
});
