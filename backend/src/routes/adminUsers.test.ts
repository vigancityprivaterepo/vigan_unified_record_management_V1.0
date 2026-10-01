import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/staffAccountCredentials';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const FIXTURE_PASSWORD = 'fixture-password-not-for-prod';

// Deactivate/reactivate/reset-password tests need an account to mutate --
// they must NOT touch the seeded demo accounts (cswd.demo, agri.demo, ...),
// since resetDb (unlike the citizen-domain tables it clears) never resets
// staff_account, and every other test file's loginAgent() call depends on
// those seeded passwords staying exactly what prisma/seed.ts set them to
// for the whole suite run. This was a real bug caught by running the full
// suite for real: an earlier version of this file reset agri.demo's
// password mid-suite and broke unrelated tests in agri.test.ts,
// auth.test.ts, and rbacMatrix.test.ts that logged in as agri.demo later.
async function createFixtureAccount(username: string, role: 'office_staff' | 'admin' = 'office_staff') {
  return prisma.staffAccount.create({
    data: { username, fullName: 'Fixture Account', role, passwordHash: await hashPassword(FIXTURE_PASSWORD) },
  });
}

describe('/admin/staff-accounts', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.staffAccount.deleteMany({ where: { fullName: 'Fixture Account' } });
    await prisma.$disconnect();
  });

  it('rejects non-admin roles', async () => {
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.get('/admin/staff-accounts');
    expect(res.status).toBe(403);
  });

  it('lists staff accounts without ever including a password hash', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/staff-accounts');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const account of res.body) {
      expect(account.passwordHash).toBeUndefined();
    }
  });

  it('creates an account with a one-time password that actually logs in, then rejects a duplicate username', async () => {
    const office = await prisma.office.create({
      data: { name: 'Test Office', slug: `test_office_${Date.now()}`, createdBy: '00000000-0000-0000-0000-000000000000' },
    });
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent
      .post('/admin/staff-accounts')
      .send({ username: 'new.office.staff', fullName: 'New Office Staff', role: 'office_staff', officeId: office.id });

    expect(res.status).toBe(201);
    expect(res.body.account.username).toBe('new.office.staff');
    expect(typeof res.body.oneTimePassword).toBe('string');
    expect(res.body.oneTimePassword.length).toBeGreaterThan(10);

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ username: 'new.office.staff', password: res.body.oneTimePassword });
    expect(loginRes.status).toBe(200);

    const dupeRes = await agent
      .post('/admin/staff-accounts')
      .send({ username: 'new.office.staff', fullName: 'Someone Else', role: 'office_staff', officeId: office.id });
    expect(dupeRes.status).toBe(409);

    await prisma.staffAccount.delete({ where: { username: 'new.office.staff' } });
  });

  it('rejects an invalid role', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent
      .post('/admin/staff-accounts')
      .send({ username: 'bad.role', fullName: 'Bad Role', role: 'app_service' });
    expect(res.status).toBe(400);
  });

  it('deactivate then reactivate round-trips isActive, and a deactivated account cannot log in', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const target = await createFixtureAccount('fixture.deactivate.test');

    const deactivateRes = await agent.patch(`/admin/staff-accounts/${target.id}/deactivate`);
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.isActive).toBe(false);

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ username: 'fixture.deactivate.test', password: FIXTURE_PASSWORD });
    expect(loginRes.status).toBe(401);

    const reactivateRes = await agent.patch(`/admin/staff-accounts/${target.id}/reactivate`);
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.isActive).toBe(true);
  });

  it('refuses to let an admin deactivate their own account', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const self = await prisma.staffAccount.findFirstOrThrow({ where: { username: 'admin.demo' } });

    const res = await agent.patch(`/admin/staff-accounts/${self.id}/deactivate`);
    expect(res.status).toBe(400);
  });

  it('reset-password sets the admin-provided password and invalidates the old one', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const target = await createFixtureAccount('fixture.reset.test');
    const newPassword = 'admin-chosen-password-123';

    const res = await agent.post(`/admin/staff-accounts/${target.id}/reset-password`).send({ password: newPassword });
    expect(res.status).toBe(204);

    const oldLoginRes = await request(app)
      .post('/auth/login')
      .send({ username: 'fixture.reset.test', password: FIXTURE_PASSWORD });
    expect(oldLoginRes.status).toBe(401);

    const newLoginRes = await request(app)
      .post('/auth/login')
      .send({ username: 'fixture.reset.test', password: newPassword });
    expect(newLoginRes.status).toBe(200);
  });

  it('reset-password rejects a password shorter than 8 characters', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const target = await createFixtureAccount('fixture.reset.short.test');

    const res = await agent.post(`/admin/staff-accounts/${target.id}/reset-password`).send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown account id', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.patch('/admin/staff-accounts/00000000-0000-0000-0000-000000000000/deactivate');
    expect(res.status).toBe(404);
  });

  it('deactivating an account kills its live session immediately, not just at next login', async () => {
    const adminAgent = await loginAgent(app, 'admin.demo');
    const target = await createFixtureAccount('fixture.session-kill.test');

    const targetAgent = request.agent(app);
    const loginRes = await targetAgent
      .post('/auth/login')
      .send({ username: 'fixture.session-kill.test', password: FIXTURE_PASSWORD });
    expect(loginRes.status).toBe(200);

    const meBeforeRes = await targetAgent.get('/auth/me');
    expect(meBeforeRes.status).toBe(200);

    const deactivateRes = await adminAgent.patch(`/admin/staff-accounts/${target.id}/deactivate`);
    expect(deactivateRes.status).toBe(200);

    const meAfterRes = await targetAgent.get('/auth/me');
    expect(meAfterRes.status).toBe(401);
  });
});
