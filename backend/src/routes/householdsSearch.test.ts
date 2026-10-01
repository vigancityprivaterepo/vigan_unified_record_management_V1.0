import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

describe('GET /admin/households?q=', () => {
  const app = createApp();

  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedHousehold() {
    const head = await prisma.citizen.create({
      data: { personLname: 'Reyes', personFname: 'Juan', personBdate: new Date('1960-01-01'), personIsHead: true },
    });
    const member = await prisma.citizen.create({
      data: {
        personLname: 'Lazo',
        personFname: 'Maria',
        personBdate: new Date('1964-01-01'),
        personParentKey: head.personKey,
        personRelationToHead: 'Spouse',
      },
    });
    await prisma.citizen.create({
      data: { personLname: 'Domingo', personFname: 'Ramon', personBdate: new Date('1958-01-01'), personIsHead: true },
    });
    return { head, member };
  }

  it("finds a household by a member's name and says which member matched", async () => {
    const { head } = await seedHousehold();
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/households').query({ q: 'lazo' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].personKey).toBe(head.personKey);
    expect(res.body.items[0].matchedMembers).toEqual(['Maria Lazo']);
  });

  it("finds a household by the head's name and by a member's person_key", async () => {
    const { head, member } = await seedHousehold();
    const agent = await loginAgent(app, 'admin.demo');
    const byHead = await agent.get('/admin/households').query({ q: 'reyes' });
    expect(byHead.body.items.map((h: { personKey: string }) => h.personKey)).toEqual([head.personKey]);
    const byKey = await agent.get('/admin/households').query({ q: member.personKey });
    expect(byKey.body.items.map((h: { personKey: string }) => h.personKey)).toEqual([head.personKey]);
  });

  it('lists every household without a search', async () => {
    await seedHousehold();
    const agent = await loginAgent(app, 'admin.demo');
    const res = await agent.get('/admin/households');
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((h: { matchedMembers: string[] }) => h.matchedMembers.length === 0)).toBe(true);
  });
});
