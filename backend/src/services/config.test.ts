import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { getFuzzyMatchThreshold, setSetting } from './config';

describe('config', () => {
  afterAll(async () => {
    // Leave the default in place for other test files / dev use.
    await setSetting('FUZZY_MATCH_THRESHOLD', '0.6');
    await prisma.$disconnect();
  });

  it('reads the fuzzy-match threshold from the settings table and reflects changes with no code deploy', async () => {
    await setSetting('FUZZY_MATCH_THRESHOLD', '0.6');
    expect(await getFuzzyMatchThreshold()).toBe(0.6);

    await setSetting('FUZZY_MATCH_THRESHOLD', '0.8');
    expect(await getFuzzyMatchThreshold()).toBe(0.8);
  });
});
