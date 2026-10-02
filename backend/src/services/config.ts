import { prisma } from '../lib/prisma';

// Fallback values, used only if a row is somehow missing -- the migration
// seeds these into app_setting so this path shouldn't normally trigger.
const DEFAULTS: Record<string, string> = {
  FUZZY_MATCH_THRESHOLD: '0.6',
  FUZZY_MATCH_BDATE_TOLERANCE_DAYS: '5',
  // Empty until the administrator marks the heritage-zone barangays.
  HERITAGE_ZONE_BARANGAYS: '',
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row) return row.value;
  const fallback = DEFAULTS[key];
  if (fallback === undefined) {
    throw new Error(`Unknown setting: ${key}`);
  }
  return fallback;
}

export async function setSetting(key: string, value: string, actorUserId?: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value, updatedBy: actorUserId },
    update: { value, updatedBy: actorUserId },
  });
}

export async function getFuzzyMatchThreshold(): Promise<number> {
  return Number(await getSetting('FUZZY_MATCH_THRESHOLD'));
}

export async function getBdateToleranceDays(): Promise<number> {
  return Number(await getSetting('FUZZY_MATCH_BDATE_TOLERANCE_DAYS'));
}
