import type { PrismaClient } from '@prisma/client';
import { summarizeRenewals } from './businessRenewals';
import { underserved } from './cityInsights';
import { reliefEvents, summarize } from './disasterLists';
import { countGap, toGapRule } from './programGaps';

// The City overview's "Needs attention" tiles: counts only, each from the
// same service as the page it links to, so the numbers always agree.
export type CityAttention = {
  gaps: { notServed: number; cleanup: number };
  disaster: { evacuatedNow: number; relief: { label: string; notReached: number; households: number } | null };
  renewals: { year: number; notRenewed: number };
  privacy: { open: number; oldestDays: number | null };
};

export async function cityAttention(client: PrismaClient): Promise<CityAttention> {
  const [u, conflictRules, events, renewals, openRequests] = await Promise.all([
    underserved(client),
    client.programGapRule.findMany({ where: { isActive: true, kind: 'conflict' } }),
    reliefEvents(client),
    summarizeRenewals(client),
    client.dataRequest.findMany({ where: { status: 'open' }, select: { receivedOn: true }, orderBy: { receivedOn: 'asc' } }),
  ]);
  let cleanup = 0;
  for (const r of conflictRules) cleanup += (await countGap(client, toGapRule(r), {})).total;
  // One pass gives both tiles: choosing an event only adds the relief
  // columns, it does not change who is listed or who is evacuated.
  const latest = events[0];
  const t = (await summarize(client, latest ? { event: latest.event } : {})).totals;
  const relief: CityAttention['disaster']['relief'] = latest
    ? { label: latest.label, notReached: t.households - t.reliefHouseholds, households: t.households }
    : null;
  const oldest = openRequests[0]?.receivedOn;
  return {
    // A person lives in one barangay, so per-barangay distinct counts add up.
    gaps: { notServed: u.barangays.reduce((n, b) => n + b.notServed, 0), cleanup },
    disaster: { evacuatedNow: t.evacuatedNow, relief },
    renewals: { year: renewals.year, notRenewed: renewals.notRenewed },
    privacy: { open: openRequests.length, oldestDays: oldest ? Math.floor((Date.now() - oldest.getTime()) / 86400000) : null },
  };
}
