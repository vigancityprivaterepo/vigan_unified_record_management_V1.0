import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

// cswd.demo belongs to the seeded CSWD office; agri.demo to Agriculture.
async function modules() {
  const cswd = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
  const agri = await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } });
  const cswdMod = await prisma.officeModule.findFirstOrThrow({ where: { officeId: cswd.id } });
  const agriMod = await prisma.officeModule.findFirstOrThrow({ where: { officeId: agri.id } });
  return { cswd, agri, cswdMod, agriMod };
}

describe('office staff charts (/offices/:officeId/widgets)', () => {
  const app = createApp();
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates, pins and deletes a chart from its own programs', async () => {
    const { cswd, cswdMod } = await modules();
    const agent = await loginAgent(app, 'cswd.demo');
    const created = await agent.post(`/offices/${cswd.id}/widgets`).send({ title: 'Seniors', sourceModuleIds: [cswdMod.id], chartType: 'number' });
    expect(created.status).toBe(201);
    expect(created.body.officeId).toBe(cswd.id);
    expect((await agent.patch(`/offices/${cswd.id}/widgets/${created.body.id}/dashboard`).send({ showOnDashboard: false })).status).toBe(200);
    expect((await agent.get(`/offices/${cswd.id}/widgets/${created.body.id}/data`)).status).toBe(200);
    expect((await agent.delete(`/offices/${cswd.id}/widgets/${created.body.id}`)).status).toBe(204);
  });

  it("refuses another office's programs and another office's route", async () => {
    const { cswd, agri, agriMod } = await modules();
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.post(`/offices/${cswd.id}/widgets`).send({ title: 'Sneaky', sourceModuleIds: [agriMod.id], chartType: 'number' });
    expect(res.status).toBe(403);
    expect((await agent.get(`/offices/${agri.id}/widgets`)).status).toBe(403);
  });

  it("shows admin's city-wide chart of its programs read-only", async () => {
    const { cswd, cswdMod } = await modules();
    const admin = await loginAgent(app, 'admin.demo');
    const city = await admin.post('/admin/dashboard/widgets').send({ title: 'City seniors', sourceModuleIds: [cswdMod.id], chartType: 'number' });
    const agent = await loginAgent(app, 'cswd.demo');
    const list = await agent.get(`/offices/${cswd.id}/widgets`);
    const row = list.body.find((w: { id: string }) => w.id === city.body.id);
    expect(row.editable).toBe(false);
    expect((await agent.delete(`/offices/${cswd.id}/widgets/${city.body.id}`)).status).toBe(404);
    await admin.delete(`/admin/dashboard/widgets/${city.body.id}`);
  });
});
