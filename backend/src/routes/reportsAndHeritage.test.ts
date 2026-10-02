import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { loginAgent } from '../testUtils/loginAgent';
import { resetDb } from '../testUtils/resetDb';

describe('program summary report and heritage zone', () => {
  const app = createApp();
  let officeId = '';
  let seniorId = '';
  let bizId = '';
  let brgy = { code: '', name: '' };
  const year = new Date().getFullYear();

  beforeAll(async () => {
    const cswd = await prisma.office.findUniqueOrThrow({ where: { slug: 'cswd' } });
    officeId = cswd.id;
    seniorId = (await prisma.officeModule.findFirstOrThrow({ where: { officeId, slug: 'senior' } })).id;
    const agri = await prisma.office.findUniqueOrThrow({ where: { slug: 'agriculture' } });
    bizId = (await prisma.officeModule.create({ data: { officeId: agri.id, name: 'Business Permits', slug: 'business_permits', collectPersonInfo: false, requiresCitizenLink: false } })).id;
    brgy = await prisma.barangay.findFirstOrThrow({ where: { name: { contains: 'Poblacion' } }, select: { code: true, name: true } });
  });
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.officeRecord.deleteMany({ where: { moduleId: bizId } });
    await prisma.officeModule.delete({ where: { id: bizId } });
    await prisma.appSetting.deleteMany({ where: { key: 'HERITAGE_ZONE_BARANGAYS' } });
    await prisma.$disconnect();
  });

  it('counts a program by sex, age group, barangay and month within the date range', async () => {
    const mk = async (sex: string, bdate: string, created: string) => {
      const c = await prisma.citizen.create({ data: { personLname: 'R', personFname: sex + bdate, personBdate: new Date(bdate), personSex: sex, personBrgyCode: brgy.code } });
      await prisma.officeRecord.create({ data: { moduleId: seniorId, personKey: c.personKey, data: {}, createdAt: new Date(created) } });
    };
    await mk('F', '1950-01-01', `${year}-02-10`);
    await mk('M', '2015-01-01', `${year}-03-10`);
    await mk('F', '1990-01-01', `${year - 1}-12-31`); // outside the range
    const agent = await loginAgent(app, 'cswd.demo');
    const url = `/offices/${officeId}/modules/${seniorId}/report?from=${year}-01-01&to=${year}-12-31`;
    const r = (await agent.get(url)).body;
    expect(r.total).toBe(2);
    expect(r.bySex).toEqual([{ name: 'Female', count: 1 }, { name: 'Male', count: 1 }]);
    expect(r.byAge).toEqual([{ name: 'Children (0-17)', count: 1 }, { name: 'Adults (18-59)', count: 0 }, { name: 'Seniors (60+)', count: 1 }]);
    expect(r.byBarangay).toEqual([{ name: brgy.name, count: 2 }]);
    expect(r.byMonth.map((m: { month: string }) => m.month)).toEqual([`${year}-02`, `${year}-03`]);
    expect((await agent.get(`/offices/${officeId}/modules/${seniorId}/report?from=${year}-12-31&to=${year}-01-01`)).status).toBe(400);
    const csv = await agent.get(url.replace('/report?', '/report.csv?'));
    expect(csv.text).toContain('Sex,Female,1');
    const agri = await loginAgent(app, 'agri.demo');
    expect((await agri.get(url)).status).toBe(403);
  });

  it('heritage zone counts businesses in the barangays the administrator marks', async () => {
    await prisma.officeRecord.createMany({
      data: [
        { moduleId: bizId, data: { business_name: 'A', business_barangay: brgy.name.toUpperCase().replace(' (POBLACION)', ''), permit_year: String(year) } },
        { moduleId: bizId, data: { business_name: 'B', business_barangay: brgy.name, permit_year: String(year - 1) } },
        { moduleId: bizId, data: { business_name: 'C', business_barangay: 'SOMEWHERE ELSE', permit_year: String(year) } },
      ],
    });
    const admin = await loginAgent(app, 'admin.demo');
    expect((await admin.get('/admin/heritage')).body.businesses.total).toBe(0);
    expect((await admin.put('/admin/heritage/barangays').send({ codes: ['NOPE'] })).status).toBe(400);
    expect((await admin.put('/admin/heritage/barangays').send({ codes: [brgy.code] })).status).toBe(200);
    const h = (await admin.get('/admin/heritage')).body;
    expect(h.barangays).toEqual([brgy]);
    expect([h.businesses.total, h.businesses.renewed, h.businesses.notRenewed]).toEqual([2, 1, 1]);
    const staff = await loginAgent(app, 'cswd.demo');
    expect((await staff.get('/admin/heritage')).status).toBe(403);
  });
});
