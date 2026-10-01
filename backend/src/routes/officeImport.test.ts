import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';
import { normalizeDate } from '../services/officeImport';

// A test program is added to the seeded Agriculture office (agri.demo) for
// this file only.
describe('bulk import (/offices/:officeId/modules/:moduleId/import)', () => {
  const app = createApp();
  let officeId = '';
  let moduleId = '';
  let brgy = { code: '', name: '' };
  const url = () => `/offices/${officeId}/modules/${moduleId}/import`;

  beforeAll(async () => {
    officeId = (await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } })).id;
    moduleId = (await prisma.officeModule.create({ data: { officeId, name: 'Import Test', slug: 'import_test' } })).id;
    await prisma.officeFormField.createMany({
      data: [
        { moduleId, key: 'crop', label: 'Crop', fieldType: 'SELECT', options: ['Rice', 'Corn'], isRequired: true, sortOrder: 0 },
        { moduleId, key: 'hectares', label: 'Hectares', fieldType: 'NUMBER', options: [], isRequired: false, sortOrder: 1 },
        { moduleId, key: 'since', label: 'Farming since', fieldType: 'DATE', options: [], isRequired: false, sortOrder: 2 },
        { moduleId, key: 'tools', label: 'Tools', fieldType: 'MULTISELECT', options: ['Plow', 'Tractor'], isRequired: false, sortOrder: 3 },
      ],
    });
    brgy = await prisma.barangay.findFirstOrThrow({ where: { name: { contains: 'Poblacion' } }, select: { code: true, name: true } });
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.officeRecord.deleteMany({ where: { moduleId } });
    await prisma.officeFormField.deleteMany({ where: { moduleId } });
    await prisma.officeModule.delete({ where: { id: moduleId } });
    await prisma.$disconnect();
  });

  const good = (fname: string, extra: Record<string, string> = {}) => ({
    core: { lname: 'Importado', fname, bdate: '3/14/1965', sex: 'female', barangay: brgy.name.toUpperCase() },
    fields: { crop: 'rice', hectares: '1,250.5', since: '1990-01-02', tools: 'plow; Tractor', ...extra },
  });

  it('reads dates as YYYY-MM-DD or month/day/year and rejects impossible ones', () => {
    expect(normalizeDate('3/14/1965')).toBe('1965-03-14');
    expect(normalizeDate('1965-3-4')).toBe('1965-03-04');
    expect(normalizeDate('2/30/2020')).toBeNull();
    expect(normalizeDate('14/3/1965')).toBeNull();
  });

  it('checks rows without writing anything, explaining each problem', async () => {
    const agent = await loginAgent(app, 'agri.demo');
    const res = await agent.post(url()).send({
      dryRun: true,
      rows: [
        good('Ana'),
        { core: { lname: 'X', fname: 'Bad', bdate: '2/30/2020' }, fields: { crop: 'Rice' } },
        { core: { lname: 'X', fname: 'Crop', bdate: '1980-01-01' }, fields: { crop: 'Wheat' } },
        { core: { lname: 'X', fname: 'Place', bdate: '1980-01-01', barangay: 'Atlantis' }, fields: { crop: 'Corn' } },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['new', 'invalid', 'invalid', 'invalid']);
    expect(res.body.results[1].errors[0]).toContain('Birthdate');
    expect(res.body.results[2].errors[0]).toContain('Crop: "Wheat" is not one of: Rice, Corn');
    expect(res.body.results[3].errors[0]).toContain('Atlantis');
    expect(await prisma.officeRecord.count({ where: { moduleId } })).toBe(0);
    expect(await prisma.citizen.count()).toBe(0);
  });

  it('imports valid rows, links a repeated person to the citizen the first row created, and skips problem rows', async () => {
    const agent = await loginAgent(app, 'agri.demo');
    const res = await agent.post(url()).send({ dryRun: false, fileName: 'farmers.csv', rows: [good('Ana'), good('Ana', { crop: 'Corn' }), { core: { lname: 'X', fname: 'Y', bdate: 'soon' } }] });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['created', 'linked', 'invalid']);

    const records = await prisma.officeRecord.findMany({ where: { moduleId }, include: { citizen: true } });
    expect(records).toHaveLength(2);
    expect(new Set(records.map((r) => r.personKey)).size).toBe(1);
    const data = records[0]!.data as Record<string, unknown>;
    expect(data).toMatchObject({ hectares: 1250.5, since: '1990-01-02', tools: ['Plow', 'Tractor'], _importBatch: res.body.batchId });
    expect(records[0]!.citizen).toMatchObject({ personSex: 'F', personBrgyCode: brgy.code, personLname: 'IMPORTADO' });
    expect(records[0]!.citizen!.personBdate!.toISOString().slice(0, 10)).toBe('1965-03-14');

    const log = await prisma.auditLog.findFirst({ where: { tableName: 'office_module', recordId: moduleId } });
    expect(log?.changedFields).toMatchObject({ event: 'bulk_import', fileName: 'farmers.csv', created: 1, linked: 1, invalid: 1 });
  });

  it("refuses another office's program and oversized requests", async () => {
    const cswd = await loginAgent(app, 'cswd.demo');
    expect((await cswd.post(url()).send({ dryRun: true, rows: [good('Ana')] })).status).toBe(403);
    const agri = await loginAgent(app, 'agri.demo');
    expect((await agri.post(url()).send({ dryRun: true, rows: Array.from({ length: 501 }, () => good('Ana')) })).status).toBe(400);
  });
});
