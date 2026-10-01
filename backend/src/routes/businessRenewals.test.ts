import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { getPrismaForRole } from '../lib/prismaByRole';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';
import { listRenewals, summarizeRenewals } from '../services/businessRenewals';

// A Business Permits module is added to the seeded Agriculture office
// (agri.demo) for this file only; access keys on the module slug.
describe('business renewals', () => {
  const app = createApp();
  let agriId = '';
  let cswdId = '';
  let moduleId = '';
  const year = new Date().getFullYear();

  async function business(name: string, permitYear: number | null, extra: Record<string, string> = {}) {
    await prisma.officeRecord.create({
      data: { moduleId, data: { business_name: name, tan_taxpayer_account_no: `TAN-${name}`, business_barangay: 'TAMAG', line_of_business: 'Retail', bpls_status_code: '3', ...(permitYear ? { permit_year: String(permitYear) } : {}), ...extra } },
    });
  }

  beforeAll(async () => {
    agriId = (await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } })).id;
    cswdId = (await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } })).id;
    moduleId = (await prisma.officeModule.create({ data: { officeId: agriId, name: 'Business Permits', slug: 'business_permits', collectPersonInfo: false, requiresCitizenLink: false } })).id;
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.officeRecord.deleteMany({ where: { moduleId } });
    await prisma.officeModule.delete({ where: { id: moduleId } });
    await prisma.$disconnect();
  });

  it('sorts businesses into renewed, not renewed, lapsed longer and no permit year', async () => {
    await business('Renewed', year);
    await business('LastYear', year - 1);
    await business('LastYear2', year - 1, { business_barangay: 'BULALA' });
    await business('Old', year - 4);
    await business('NoYear', null);
    const s = await summarizeRenewals(getPrismaForRole('admin'));
    expect([s.renewed, s.notRenewed, s.lapsedLonger, s.noYear, s.total]).toEqual([1, 2, 1, 1, 5]);
    expect(s.notRenewedByBarangay.map((b) => b.name).sort()).toEqual(['BULALA', 'TAMAG']);
  });

  it('filters the list by last permit year, barangay and search', async () => {
    await business('Sari Store', year - 1);
    await business('Bakery', year - 1, { business_barangay: 'BULALA' });
    await business('Renewed', year);
    const c = getPrismaForRole('admin');
    expect((await listRenewals(c, { lastYear: year - 1 }, null)).total).toBe(2);
    expect((await listRenewals(c, { lastYear: year - 1, barangay: 'BULALA' }, null)).items.map((b) => b.businessName)).toEqual(['Bakery']);
    expect((await listRenewals(c, { q: 'sari' }, null)).items.map((b) => b.businessName)).toEqual(['Sari Store']);
    expect((await listRenewals(c, { q: '100%_' }, null)).total).toBe(0);
  });

  it('is available to the office that runs Business Permits and to admin only', async () => {
    await business('LastYear', year - 1);
    const agri = await loginAgent(app, 'agri.demo');
    expect((await agri.get(`/offices/${agriId}/lists`)).body.businessRenewals).toBe(true);
    expect((await agri.get(`/offices/${agriId}/business-renewals`)).status).toBe(200);
    const list = await agri.get(`/offices/${agriId}/business-renewals/list?lastYear=${year - 1}`);
    expect(list.body.total).toBe(1);
    expect((await agri.get(`/offices/${agriId}/business-renewals/list?lastYear=abc`)).status).toBe(400);

    const cswd = await loginAgent(app, 'cswd.demo');
    expect((await cswd.get(`/offices/${cswdId}/business-renewals`)).status).toBe(403);
    expect((await cswd.get(`/offices/${agriId}/business-renewals`)).status).toBe(403);

    const admin = await loginAgent(app, 'admin.demo');
    expect((await admin.get('/admin/business-renewals')).status).toBe(200);
  });
});
