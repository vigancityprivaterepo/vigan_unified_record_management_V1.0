import { describe, expect, it } from 'vitest';
import { getPrismaForRole } from '../lib/prismaByRole';
import { computeOfficeBreakdown } from './officeBreakdown';

// Mirrors adminInsights.test.ts's approach: runs against the real seeded DB.
describe('computeOfficeBreakdown', () => {
  it('returns every active office with its accent and icon', async () => {
    const data = await computeOfficeBreakdown(getPrismaForRole('admin'), {});
    expect(data.offices.length).toBeGreaterThan(0);
    for (const o of data.offices) {
      expect(o.accentHue).toBeGreaterThanOrEqual(0);
      expect(o.accentHue).toBeLessThan(360);
      expect(typeof o.icon).toBe('string');
    }
  });

  it('month counts sum to the number of non-archived office records', async () => {
    const client = getPrismaForRole('admin');
    const data = await computeOfficeBreakdown(client, {});
    const summed = data.months.reduce((a, m) => a + Object.values(m.counts).reduce((x, y) => x + y, 0), 0);
    expect(summed).toBe(await client.officeRecord.count({ where: { isArchived: false } }));
  });

  it('every module maps to an office', async () => {
    const data = await computeOfficeBreakdown(getPrismaForRole('admin'), {});
    const officeIds = new Set(data.offices.map((o) => o.id));
    for (const officeId of Object.values(data.moduleOffice)) expect(typeof officeId).toBe('string');
    expect(officeIds.size).toBe(data.offices.length);
  });
});
