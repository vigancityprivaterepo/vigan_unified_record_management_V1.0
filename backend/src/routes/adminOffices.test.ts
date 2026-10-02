import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';

describe('creating offices and programs: what each record is about', () => {
  const app = createApp();
  const created: string[] = [];
  afterAll(async () => {
    await prisma.officeModule.deleteMany({ where: { officeId: { in: created } } });
    await prisma.office.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  async function office(body: Record<string, unknown>) {
    const admin = await loginAgent(app, 'admin.demo');
    const slug = `t_${randomUUID().slice(0, 8)}`;
    const res = await admin.post('/admin/offices').send({ name: `Test ${slug}`, slug, ...body });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    return { admin, id: res.body.id as string, first: await prisma.officeModule.findFirstOrThrow({ where: { officeId: res.body.id } }) };
  }

  it('keeps the old default (resident, registry required) when nothing is chosen', async () => {
    const { first } = await office({});
    expect([first.collectPersonInfo, first.requiresCitizenLink]).toEqual([true, true]);
  });

  it('creates a first program with an optional link, or not about a person', async () => {
    expect((await office({ collectPersonInfo: true, requiresCitizenLink: false })).first.requiresCitizenLink).toBe(false);
    const none = await office({ collectPersonInfo: false, requiresCitizenLink: true });
    expect([none.first.collectPersonInfo, none.first.requiresCitizenLink]).toEqual([false, false]);
  });

  it('adds a program that is not about a person', async () => {
    const { admin, id } = await office({});
    const res = await admin.post(`/admin/offices/${id}/modules`).send({ name: 'Projects', slug: 'projects', collectPersonInfo: false });
    expect(res.status).toBe(201);
    expect([res.body.collectPersonInfo, res.body.requiresCitizenLink]).toEqual([false, false]);
  });
});
