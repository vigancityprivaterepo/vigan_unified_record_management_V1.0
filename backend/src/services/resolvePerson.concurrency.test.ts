import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { resetDb } from '../testUtils/resetDb';
import { resolvePerson } from './resolvePerson';

describe('resolvePerson concurrency', () => {
  beforeEach(resetDb);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates only one Citizen row when two offices resolve the same new person at the same time', async () => {
    const candidate = { lname: 'Padilla', fname: 'Rosalinda', bdate: new Date('1988-03-03') };

    const [a, b] = await Promise.all([resolvePerson(candidate), resolvePerson(candidate)]);

    // Exactly one call creates the row; the other, serialized behind the
    // advisory lock, re-checks and reuses it -- never two 'created's.
    expect([a.status, b.status].sort()).toEqual(['created', 'matched']);

    const created = a.status === 'created' ? a : b;
    const matched = a.status === 'matched' ? a : b;
    if (created.status === 'created' && matched.status === 'matched') {
      expect(matched.personKey).toBe(created.personKey);
    }

    const count = await prisma.citizen.count({
      where: { personLname: 'Padilla', personFname: 'Rosalinda', personBdate: new Date('1988-03-03') },
    });
    expect(count).toBe(1);
  });
});
