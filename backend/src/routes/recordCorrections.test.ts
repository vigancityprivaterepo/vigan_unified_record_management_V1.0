import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actorUserId = '00000000-0000-0000-0000-000000000000';

// A CSWD module with one text field and one dropdown, plus one unlinked record.
async function seed() {
  const office = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
  const officeModule = await prisma.officeModule.create({
    data: { officeId: office.id, name: 'Corrections Test', slug: `corr_${Date.now()}_${Math.random().toString(36).slice(2)}`, requiresCitizenLink: false },
  });
  await prisma.officeFormField.createMany({
    data: [
      { moduleId: officeModule.id, key: 'id_no', label: 'ID No.', fieldType: 'TEXT', sortOrder: 0 },
      { moduleId: officeModule.id, key: 'kind', label: 'Kind', fieldType: 'SELECT', options: ['Walk-in', 'Barangay'], sortOrder: 1 },
    ],
  });
  const record = await prisma.officeRecord.create({
    data: {
      moduleId: officeModule.id,
      unresolvedPerson: { lname: 'SANTOS', fname: 'ANA', bdate: '1990-01-01' },
      data: { id_no: 'A-1', kind: 'Walk-in' },
      createdBy: actorUserId,
    },
  });
  return { officeModule, record, base: `/offices/${office.id}/modules/${officeModule.id}/records/${record.id}` };
}

describe('record corrections + restore', () => {
  const app = createApp();
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('edits fields with a reason, keeps dropdown case, uppercases free text, and audits before/after', async () => {
    const { record, base } = await seed();
    const agent = await loginAgent(app, 'cswd.demo');
    const res = await agent.patch(base).send({ reason: 'Typo at intake', fields: { id_no: 'a-2', kind: 'Barangay' } });
    expect(res.status).toBe(200);
    const after = await prisma.officeRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.data).toMatchObject({ id_no: 'A-2', kind: 'Barangay' });
    const log = await prisma.auditLog.findFirst({ where: { recordId: record.id, action: 'update' } });
    expect(log?.changedFields).toMatchObject({ event: 'correction', reason: 'Typo at intake', changes: { id_no: { from: 'A-1', to: 'A-2' } } });
  });

  it('rejects a missing reason, an invalid option, and a no-op', async () => {
    const { base } = await seed();
    const agent = await loginAgent(app, 'cswd.demo');
    expect((await agent.patch(base).send({ fields: { id_no: 'X' } })).status).toBe(400);
    expect((await agent.patch(base).send({ reason: 'Bad option', fields: { kind: 'Nope' } })).status).toBe(400);
    const noop = await agent.patch(base).send({ reason: 'Nothing', fields: { kind: 'Walk-in' } });
    expect(noop.body.error.code).toBe('NO_CHANGES');
  });

  it("corrects an unlinked record's name, and blocks other offices", async () => {
    const { record, base } = await seed();
    const agent = await loginAgent(app, 'cswd.demo');
    expect((await agent.patch(base).send({ reason: 'Misspelled', person: { lname: 'Santoz' } })).status).toBe(200);
    const after = await prisma.officeRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.unresolvedPerson).toMatchObject({ lname: 'SANTOZ' });
    const other = await loginAgent(app, 'agri.demo');
    expect((await other.patch(base).send({ reason: 'Not mine', fields: { id_no: 'Z' } })).status).toBe(403);
  });

  it('archives, lists as archived, and restores with a reason', async () => {
    const { officeModule, record, base } = await seed();
    const agent = await loginAgent(app, 'cswd.demo');
    expect((await agent.delete(base).send({ reason: 'Wrong person' })).status).toBe(204);
    const list = await agent.get(`/offices/${officeModule.officeId}/modules/${officeModule.id}/records`).query({ archived: 'true' });
    expect(list.body.total).toBe(1);
    expect((await agent.post(`${base}/restore`).send({})).status).toBe(400);
    expect((await agent.post(`${base}/restore`).send({ reason: 'Archived by mistake' })).status).toBe(204);
    expect((await prisma.officeRecord.findUniqueOrThrow({ where: { id: record.id } })).isArchived).toBe(false);
  });
});
