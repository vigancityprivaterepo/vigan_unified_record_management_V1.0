import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { viewerMayRead } from '../middleware/auth';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

// A 'viewer' account (the mayor, other officials): counts and charts only.
describe('view-only account for city officials', () => {
  const app = createApp();
  const USERNAME = 'mayor.test';
  const PASSWORD = 'view-only-test-password';

  beforeEach(async () => {
    await resetDb();
    await prisma.staffAccount.deleteMany({ where: { username: USERNAME } });
  });
  afterAll(async () => {
    await prisma.staffAccount.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  // The admin creates the account in Staff accounts; the official then signs in.
  async function official() {
    const admin = await loginAgent(app, 'admin.demo');
    const created = await admin.post('/admin/staff-accounts').send({ username: USERNAME, fullName: 'City Mayor', role: 'viewer', password: PASSWORD });
    expect(created.status).toBe(201);
    const agent = request.agent(app);
    const login = await agent.post('/auth/login').send({ username: USERNAME, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('viewer');
    return { admin, agent };
  }

  it('opens the city-wide counts and charts', async () => {
    const senior = await prisma.officeModule.findFirstOrThrow({ where: { slug: 'senior', office: { slug: 'cswd' } } });
    const { admin, agent } = await official();
    const chart = await admin.post('/admin/dashboard/widgets').send({ title: 'Seniors', sourceModuleIds: [senior.id], chartType: 'number' });

    for (const path of [
      '/admin/dashboard/summary', '/admin/insights/summary', '/admin/insights/sankey', '/admin/insights/office-breakdown',
      '/admin/insights/questions', '/admin/insights/attention', '/admin/dashboard/widgets', '/admin/offices', `/admin/offices/${senior.officeId}/modules`,
      '/admin/program-gaps', '/admin/assistance', '/barangays',
      `/admin/dashboard/widgets/${chart.body.id as string}/data`,
      `/admin/dashboard/widgets/${chart.body.id as string}/explore/history`,
      `/admin/dashboard/widgets/${chart.body.id as string}/explore/profile`,
    ]) {
      expect((await agent.get(path)).status, path).toBe(200);
    }
    expect((await agent.get('/admin/insights/summary?barangayCode=VIG-001')).status).toBe(200);
  });

  it('is refused anything that lists people, and every change', async () => {
    const senior = await prisma.officeModule.findFirstOrThrow({ where: { slug: 'senior', office: { slug: 'cswd' } } });
    const person = await prisma.citizen.create({ data: { personLname: 'Abad', personFname: 'Test', personBdate: new Date('1950-01-01') } });
    const rule = await prisma.programGapRule.create({ data: { name: 'Seniors not listed (viewer test)', kind: 'missing', targetModuleId: senior.id, minAge: 60 } });
    const { admin, agent } = await official();
    const chart = await admin.post('/admin/dashboard/widgets').send({ title: 'Seniors', sourceModuleIds: [senior.id], chartType: 'number' });
    const id = chart.body.id as string;

    for (const path of [
      '/admin/citizens', `/admin/citizens/${person.personKey}`, '/admin/citizens/export.csv', '/admin/households', '/admin/insights/citizens',
      `/admin/dashboard/widgets/${id}/explore/records`, `/admin/dashboard/widgets/${id}/explore/records.csv`,
      `/admin/program-gaps/${rule.id}/people`, `/admin/program-gaps/${rule.id}/people.csv`, `/admin/program-gaps/${rule.id}/print`,
      '/admin/disaster-lists/people', '/admin/business-renewals/list', '/admin/assistance/list', '/admin/assistance/list.csv', '/admin/privacy/requests', '/admin/staff-accounts', '/admin/duplicate-review-queue', '/admin/settings',
      `/offices/${senior.officeId}/modules/${senior.id}/records`, `/offices/${senior.officeId}/widgets`,
    ]) {
      expect((await agent.get(path)).status, path).toBe(403);
    }
    expect((await agent.post('/admin/dashboard/widgets').send({ title: 'Mine', sourceModuleIds: [senior.id], chartType: 'number' })).status).toBe(403);
    expect((await agent.delete(`/admin/dashboard/widgets/${id}`)).status).toBe(403);
    expect((await agent.patch(`/admin/dashboard/widgets/${id}/dashboard`).send({ showOnDashboard: false })).status).toBe(403);
    expect((await agent.put(`/admin/program-gaps/${rule.id}/people/${person.personKey}/outreach`).send({ status: 'reached' })).status).toBe(403);
    expect((await agent.post('/admin/staff-accounts').send({ username: 'sneaky', fullName: 'Sneaky', role: 'admin' })).status).toBe(403);
    expect((await agent.post(`/offices/${senior.officeId}/modules/${senior.id}/records`).field('lname', 'X').field('fname', 'Y').field('bdate', '1950-01-01')).status).toBe(403);
    await prisma.programGapRule.delete({ where: { id: rule.id } });
  });

  it('allows only exact read routes', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(viewerMayRead('GET', '/admin/program-gaps')).toBe(true);
    expect(viewerMayRead('GET', '/admin/program-gaps/?barangayCode=VIG-001')).toBe(true);
    expect(viewerMayRead('GET', `/admin/dashboard/widgets/${id}/explore/history?label=Tamag`)).toBe(true);
    expect(viewerMayRead('POST', '/admin/program-gaps')).toBe(false);
    expect(viewerMayRead('GET', `/admin/program-gaps/${id}/people`)).toBe(false);
    expect(viewerMayRead('GET', `/admin/dashboard/widgets/${id}/explore/records`)).toBe(false);
    expect(viewerMayRead('GET', '/admin/citizens/export.csv?x=/admin/program-gaps')).toBe(false);
    expect(viewerMayRead('GET', '/admin/insights/citizens')).toBe(false);
  });

  it('an administrator cannot attach a view-only account to an office', async () => {
    const office = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
    const admin = await loginAgent(app, 'admin.demo');
    const created = await admin.post('/admin/staff-accounts').send({ username: USERNAME, fullName: 'City Mayor', role: 'viewer', officeId: office.id, password: PASSWORD });
    expect(created.status).toBe(201);
    expect((await prisma.staffAccount.findUniqueOrThrow({ where: { username: USERNAME } })).officeId).toBeNull();
  });
});
