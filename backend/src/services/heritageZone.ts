import type { PrismaClient } from '@prisma/client';
import { getSetting, setSetting } from './config';
import { normBrgy } from './officeImport';

// Heritage zone: what is happening inside the barangays the administrator
// marks as heritage zone (setting HERITAGE_ZONE_BARANGAYS, comma-separated
// barangay codes; empty until set, since the official boundary is the
// city's to define, not the system's).
//
// A record counts as inside the zone when its own heritage field says so
// (building permits: within_heritage_zone; zoning clearances:
// within_heritage_core_or_buffer_zone) OR its barangay is a marked one:
//   business_permits   data.business_barangay ("BARANGAY VIII")
//   building_permits   data.project_barangay
//   occupancy_permits  data.property_barangay
//   zoning_clearance   data.project_location_barangay_street ("STREET, BARANGAY")
// Barangay names are compared loosely (normBrgy: "BARANGAY VIII" =
// "Barangay VIII (Poblacion)").

export const HERITAGE_SETTING = 'HERITAGE_ZONE_BARANGAYS';

export async function getHeritageBarangays(): Promise<string[]> {
  const raw = await getSetting(HERITAGE_SETTING);
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function setHeritageBarangays(codes: string[], actorUserId: string): Promise<void> {
  await setSetting(HERITAGE_SETTING, [...new Set(codes)].join(','), actorUserId);
}

const truthy = (v: unknown) => v === true || (typeof v === 'string' && ['true', 'yes', 'y'].includes(v.trim().toLowerCase()));

type Rec = { data: Record<string, unknown>; createdAt: Date };

export type HeritageSummary = {
  barangays: Array<{ code: string; name: string }>;
  year: number;
  businesses: { total: number; renewed: number; notRenewed: number; lapsed: number; noYear: number; byBarangay: Array<{ name: string; total: number; notRenewed: number }> };
  buildingPermits: { total: number; thisYear: number; byFlag: number; byBarangay: Array<{ name: string; count: number }>; byUse: Array<{ name: string; count: number }> };
  occupancyPermits: { total: number; thisYear: number };
  zoning: { total: number; byDecision: Array<{ name: string; count: number }> };
  usesSampleData: boolean;
};

const top = (m: Map<string, number>, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

export async function heritageSummary(client: PrismaClient): Promise<HeritageSummary> {
  const codes = await getHeritageBarangays();
  const all = await client.barangay.findMany({ select: { code: true, name: true }, orderBy: { name: 'asc' } });
  const chosen = all.filter((b) => codes.includes(b.code));
  const keyToName = new Map(chosen.map((b) => [normBrgy(b.name), b.name]));
  const inZone = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? keyToName.get(normBrgy(v)) ?? null : null);
  const year = new Date().getFullYear();

  const load = async (slug: string): Promise<Rec[]> =>
    (await client.officeRecord.findMany({
      where: { isArchived: false, module: { slug } },
      select: { data: true, createdAt: true },
    })).map((r) => ({ data: (r.data ?? {}) as Record<string, unknown>, createdAt: r.createdAt }));

  const [biz, bld, occ, zon] = await Promise.all([load('business_permits'), load('building_permits'), load('occupancy_permits'), load('zoning_clearance')]);
  let sample = false;
  const note = (r: Rec) => { if (r.data._sample === true || r.data._sample === 'true') sample = true; };

  // Businesses in marked barangays, by latest permit year (same buckets as Business renewals).
  const bizBy = new Map<string, { total: number; notRenewed: number }>();
  const b = { total: 0, renewed: 0, notRenewed: 0, lapsed: 0, noYear: 0 };
  for (const r of biz) {
    const name = inZone(r.data.business_barangay);
    if (!name) continue;
    note(r);
    const y = Number(r.data.permit_year);
    const slot = bizBy.get(name) ?? { total: 0, notRenewed: 0 };
    b.total++; slot.total++;
    if (!Number.isInteger(y) || !y) b.noYear++;
    else if (y >= year) b.renewed++;
    else if (y === year - 1) { b.notRenewed++; slot.notRenewed++; }
    else b.lapsed++;
    bizBy.set(name, slot);
  }

  // Building permits: own flag or marked barangay.
  const bldBrgy = new Map<string, number>();
  const bldUse = new Map<string, number>();
  let bldTotal = 0, bldYear = 0, bldFlag = 0;
  for (const r of bld) {
    const name = inZone(r.data.project_barangay);
    const flagged = truthy(r.data.within_heritage_zone);
    if (!name && !flagged) continue;
    note(r);
    bldTotal++;
    if (flagged) bldFlag++;
    if (String(r.data.date_issued ?? r.createdAt.toISOString()).startsWith(String(year))) bldYear++;
    const label = name ?? (typeof r.data.project_barangay === 'string' ? r.data.project_barangay : 'Not recorded');
    bldBrgy.set(label, (bldBrgy.get(label) ?? 0) + 1);
    const use = typeof r.data.building_use === 'string' && r.data.building_use ? r.data.building_use : 'Not recorded';
    bldUse.set(use, (bldUse.get(use) ?? 0) + 1);
  }

  let occTotal = 0, occYear = 0;
  for (const r of occ) {
    if (!inZone(r.data.property_barangay)) continue;
    note(r);
    occTotal++;
    if (String(r.data.date_issued ?? r.createdAt.toISOString()).startsWith(String(year))) occYear++;
  }

  const decision = new Map<string, number>();
  let zonTotal = 0;
  for (const r of zon) {
    const loc = typeof r.data.project_location_barangay_street === 'string' ? r.data.project_location_barangay_street : '';
    const brgyPart = loc.includes(',') ? loc.slice(loc.lastIndexOf(',') + 1) : loc;
    if (!inZone(brgyPart) && !truthy(r.data.within_heritage_core_or_buffer_zone)) continue;
    note(r);
    zonTotal++;
    const d = typeof r.data.decision === 'string' && r.data.decision ? r.data.decision : 'Not recorded';
    decision.set(d, (decision.get(d) ?? 0) + 1);
  }

  return {
    barangays: chosen,
    year,
    businesses: { ...b, byBarangay: [...bizBy.entries()].sort((x, y) => y[1].total - x[1].total).map(([name, v]) => ({ name, ...v })) },
    buildingPermits: { total: bldTotal, thisYear: bldYear, byFlag: bldFlag, byBarangay: top(bldBrgy), byUse: top(bldUse, 6) },
    occupancyPermits: { total: occTotal, thisYear: occYear },
    zoning: { total: zonTotal, byDecision: top(decision) },
    usesSampleData: sample,
  };
}
