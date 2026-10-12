import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

const actor = '00000000-0000-0000-0000-000000000000';

// Three PWD records (two "Visual", one "Hearing", one of them sample) and a
// city-wide bar chart of them by type of disability.
async function setup(app: ReturnType<typeof createApp>) {
  const cswd = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
  const agri = await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } });
  const pwd = await prisma.officeModule.findFirstOrThrow({ where: { officeId: cswd.id, slug: 'pwd' } });
  const rows: Array<[string, Record<string, unknown>]> = [
    ['Abad', { type_of_disability: 'Visual', has_id: true }],
    ['Bello', { type_of_disability: 'Visual', has_id: false, _sample: true }],
    ['Cruz', { type_of_disability: 'Hearing', has_id: true }],
  ];
  for (const [lname, data] of rows) {
    const c = await prisma.citizen.create({ data: { personLname: lname, personFname: 'Test', personBdate: new Date('1980-01-01') } });
    await prisma.officeRecord.create({ data: { moduleId: pwd.id, personKey: c.personKey, data: data as object, createdBy: actor, updatedBy: actor } });
  }
  const admin = await loginAgent(app, 'admin.demo');
  const chart = await admin.post('/admin/dashboard/widgets').send({ title: 'PWD by type', sourceModuleIds: [pwd.id], chartType: 'bar', groupBy: ['field:type_of_disability'] });
  expect(chart.status).toBe(201);
  return { cswd, agri, pwd, admin, base: `/admin/dashboard/widgets/${chart.body.id as string}`, chartId: chart.body.id as string };
}

describe('what is behind a chart (/explore)', () => {
  const app = createApp();
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a bar opens exactly the records it counts', async () => {
    const { admin, base, pwd } = await setup(app);
    const chart = await admin.get(`${base}/data`);
    const visual = chart.body.find((r: { label: string }) => r.label === 'Visual');
    expect(visual.counts).toEqual([2]);

    const one = await admin.get(`${base}/explore/records`).query({ label: 'Visual' });
    expect(one.status).toBe(200);
    expect(one.body.total).toBe(2);
    expect(one.body.items.map((r: { person: string }) => r.person).sort()).toEqual(['Abad, Test', 'Bello, Test']);
    expect(one.body.items.find((r: { person: string }) => r.person === 'Bello, Test').sample).toBe(true);
    expect(one.body.items[0].values).not.toHaveProperty('_sample');
    expect(one.body.columns.map((c: { key: string }) => c.key)).toContain('type_of_disability');

    expect((await admin.get(`${base}/explore/records`)).body.total).toBe(3);
    expect((await admin.get(`${base}/explore/records`).query({ moduleId: '00000000-0000-0000-0000-000000000001' })).status).toBe(400);
    expect((await admin.get(`${base}/explore/records`).query({ moduleId: pwd.id, label: 'Nobody' })).body.total).toBe(0);
  });

  it('history and the data profile describe the same records', async () => {
    const { admin, base } = await setup(app);
    const all = await admin.get(`${base}/explore/history`);
    expect(all.body.summary[0]).toMatchObject({ records: 3, people: 3 });
    expect(all.body.months[all.body.months.length - 1].values).toEqual([3]);
    const visual = await admin.get(`${base}/explore/history`).query({ label: 'Visual' });
    expect(visual.body.summary[0].records).toBe(2);

    const profile = await admin.get(`${base}/explore/profile`);
    expect(profile.body[0]).toMatchObject({ records: 3, sample: 1, people: 3, notLinked: 0 });
    const field = profile.body[0].fields.find((f: { key: string }) => f.key === 'type_of_disability');
    expect(field).toMatchObject({ filled: 3, distinct: 2 });
  });

  it('exports the records and logs who opened them', async () => {
    const { admin, base, chartId } = await setup(app);
    const csv = await admin.get(`${base}/explore/records.csv`).query({ label: 'Hearing' });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Date added');
    expect(csv.text).toContain('Cruz, Test');
    expect(csv.text).not.toContain('Abad, Test');
    await admin.get(`${base}/explore/records`);

    const logged = await prisma.auditLog.findMany({ where: { tableName: 'office_record', action: 'read' } });
    const fromChart = logged.map((l) => l.changedFields as Record<string, unknown>).filter((f) => f?.source === 'chart' && f.widgetId === chartId);
    expect(fromChart).toHaveLength(2);
    expect(fromChart.some((f) => f.export === true && f.label === 'Hearing')).toBe(true);
  });

  it("an office sees its own charts' records, not another office's", async () => {
    const { cswd, agri, chartId } = await setup(app);
    const own = await loginAgent(app, 'cswd.demo');
    expect((await own.get(`/offices/${cswd.id}/widgets/${chartId}/explore/records`)).body.total).toBe(3);
    expect((await own.get(`/offices/${cswd.id}/widgets/${chartId}/explore/history`)).status).toBe(200);
    expect((await own.get(`/offices/${cswd.id}/widgets/${chartId}/explore/profile`)).status).toBe(200);

    const other = await loginAgent(app, 'agri.demo');
    expect((await other.get(`/offices/${agri.id}/widgets/${chartId}/explore/records`)).status).toBe(404);
    expect((await other.get(`/offices/${cswd.id}/widgets/${chartId}/explore/records`)).status).toBe(403);
    expect((await other.get(`/admin/dashboard/widgets/${chartId}/explore/records`)).status).toBe(403);
  });
});
