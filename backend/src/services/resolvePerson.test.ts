import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { resetDb } from '../testUtils/resetDb';
import { setSetting } from './config';
import { resolvePerson } from './resolvePerson';

describe('resolvePerson', () => {
  beforeEach(async () => {
    await resetDb();
    await setSetting('FUZZY_MATCH_THRESHOLD', '0.6');
    await setSetting('FUZZY_MATCH_BDATE_TOLERANCE_DAYS', '5');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns matched for an exact, case-insensitive, trimmed match', async () => {
    const existing = await prisma.citizen.create({
      data: { personLname: 'Reyes', personFname: 'Juan', personBdate: new Date('1980-05-12') },
    });

    const result = await resolvePerson({ lname: '  REYES ', fname: ' juan ', bdate: new Date('1980-05-12') });

    expect(result).toEqual({ status: 'matched', personKey: existing.personKey });
  });

  it('flags a fuzzy match at/above the threshold for review instead of auto-deciding', async () => {
    const existing = await prisma.citizen.create({
      data: { personLname: 'Bautista', personFname: 'Antonio', personBdate: new Date('1975-01-01') },
    });

    // One-letter surname typo, same bdate -> high trigram similarity, not
    // an exact match.
    const result = await resolvePerson({ lname: 'Bautist', fname: 'Antonio', bdate: new Date('1975-01-01') });

    expect(result.status).toBe('needs_review');
    if (result.status === 'needs_review') {
      expect(result.candidates.map((c) => c.personKey)).toContain(existing.personKey);
      expect(result.candidates[0]?.similarity).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('creates a new citizen when the best match is below threshold', async () => {
    await prisma.citizen.create({
      data: { personLname: 'Domingo', personFname: 'Ramon', personBdate: new Date('1955-01-01') },
    });

    // Unrelated name and birthdate -> similarity well below threshold, and
    // outside the bdate tolerance window.
    const result = await resolvePerson({ lname: 'Zapanta', fname: 'Corazon', bdate: new Date('1990-09-09') });

    expect(result.status).toBe('created');
  });

  it('creates a new citizen when there is no match at all', async () => {
    const result = await resolvePerson({ lname: 'Ilagan', fname: 'Marites', bdate: new Date('1999-12-01') });

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      const row = await prisma.citizen.findUnique({ where: { personKey: result.personKey } });
      expect(row?.personLname).toBe('Ilagan');
      expect(row?.personFname).toBe('Marites');
    }
  });
});
