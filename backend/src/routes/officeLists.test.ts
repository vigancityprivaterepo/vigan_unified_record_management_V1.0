import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

// cswd.demo belongs to the seeded CSWD office; agri.demo to Agriculture.
// Agriculture is given an Evacuees program for the duration of this file, so
// it stands in for "the office that runs Evacuees" (CDRRMO in production).
describe('office lists (/offices/:officeId/program-gaps, /disaster-lists)', () => {
  const app = createApp();
  let cswd = { id: '' };
  let agri = { id: '' };
  let cswdRule = '';
  let agriRule = '';
  let offRule = '';
  let evacueesId = '';

  beforeAll(async () => {
    cswd = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
    agri = await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } });
    const senior = await prisma.officeModule.findFirstOrThrow({ where: { officeId: cswd.id, slug: 'senior' } });
    const farmer = await prisma.officeModule.findFirstOrThrow({ where: { officeId: agri.id, slug: 'farmer' } });
    evacueesId = (await prisma.officeModule.create({ data: { officeId: agri.id, name: 'Evacuees', slug: 'evacuees' } })).id;
    cswdRule = (await prisma.programGapRule.create({ data: { name: 'Seniors not listed', kind: 'missing', targetModuleId: senior.id, minAge: 60 } })).id;
    offRule = (await prisma.programGapRule.create({ data: { name: 'Switched off', kind: 'missing', targetModuleId: senior.id, minAge: 70, isActive: false } })).id;
    agriRule = (await prisma.programGapRule.create({ data: { name: 'Farmers rule', kind: 'missing', targetModuleId: farmer.id, minAge: 18 } })).id;
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.programGapRule.deleteMany({ where: { id: { in: [cswdRule, agriRule, offRule] } } });
    await prisma.officeModule.delete({ where: { id: evacueesId } });
    await prisma.$disconnect();
  });

  it('shows an office only the active rules that target its own programs', async () => {
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.get(`/offices/${cswd.id}/program-gaps`);
    expect(res.status).toBe(200);
    expect(res.body.rules.map((r: { id: string }) => r.id)).toEqual([cswdRule]);
    expect(res.body.programs).toEqual([]);
    expect((await agent.get(`/offices/${cswd.id}/program-gaps/${cswdRule}/people`)).status).toBe(200);
    expect((await agent.get(`/offices/${cswd.id}/program-gaps/${agriRule}/people`)).status).toBe(404);
    expect((await agent.get(`/offices/${cswd.id}/program-gaps/${offRule}/people`)).status).toBe(404);
    expect((await agent.get(`/offices/${agri.id}/program-gaps`)).status).toBe(403);
  });

  it('gives disaster lists only to the office that runs Evacuees', async () => {
    const cswdAgent = await loginAgent(app, 'cswd.demo');
    expect((await cswdAgent.get(`/offices/${cswd.id}/disaster-lists`)).status).toBe(403);
    expect((await cswdAgent.get(`/offices/${cswd.id}/lists`)).body).toEqual({ programGaps: 1, disasterLists: false });

    const agriAgent = await loginAgent(app, 'agri.demo');
    expect((await agriAgent.get(`/offices/${agri.id}/lists`)).body).toEqual({ programGaps: 1, disasterLists: true });
    expect((await agriAgent.get(`/offices/${agri.id}/disaster-lists`)).status).toBe(200);
    expect((await agriAgent.get(`/offices/${agri.id}/disaster-lists/people`)).status).toBe(200);
  });

  it('records each list view in the audit log with the office', async () => {
    const agent = await loginAgent(app, 'agri.demo');
    await agent.get(`/offices/${agri.id}/disaster-lists/people`);
    const log = await prisma.auditLog.findFirst({ where: { tableName: 'Citizen', action: 'read' }, orderBy: { timestamp: 'desc' } });
    expect(log?.changedFields).toMatchObject({ view: 'disaster-list:people', officeId: agri.id });
  });

  it('admin still sees every rule, including switched-off ones', async () => {
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/program-gaps');
    expect(res.status).toBe(200);
    expect(res.body.rules.map((r: { id: string }) => r.id).sort()).toEqual([cswdRule, agriRule, offRule].sort());
    expect((await agent.get(`/admin/program-gaps/${offRule}/people`)).status).toBe(200);
  });
});
