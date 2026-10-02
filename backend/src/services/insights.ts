import { Prisma, type PrismaClient } from '@prisma/client';

// Vital-event modules (a birth or death is a one-time record, not an
// ongoing membership like Senior/PWD/Farmer) are excluded from the
// category-overlap story -- there's no schema flag for this distinction
// (requiresCitizenLink doesn't separate them, Death also requires a link),
// so it's a fixed slug list here. Revisit with a real OfficeModule.category
// column only if the vital-event set grows past these two.
const EXCLUDED_CATEGORY_MODULE_SLUGS = ['birth', 'death'];

const MAX_SANKEY_BUCKETS = 20;

export type InsightsSummary = {
  totalCitizens: number;
  totalHouseholds: number;
  overlapCount: number;
  completenessPct: number;
};

export type SankeyModule = { id: string; name: string; slug: string };
export type SankeyBucket = { moduleIds: string[]; label: string; count: number };
export type SankeyData = { modules: SankeyModule[]; buckets: SankeyBucket[] };

export type BarangayRankingRow = { code: string; name: string; count: number };

export type TrendPoint = { month: string; registrations: number; merges: number };

export type InsightsCitizenRow = {
  personKey: string;
  personLname: string;
  personFname: string;
  barangayName: string | null;
  personIsHead: boolean;
  personParentKey: string | null;
};

export type InsightsFilterParams = {
  barangayCode?: string;
  from?: string; // 'YYYY-MM'
  to?: string; // 'YYYY-MM'
};

// Every membership-type module, in a stable order that never reshuffles as
// new modules are added -- this order IS the palette slot assignment on the
// frontend (module at index 0 always gets categorical slot 1), so it has to
// be deterministic and append-only.
async function membershipModules(client: PrismaClient): Promise<SankeyModule[]> {
  const modules = await client.officeModule.findMany({
    where: { collectPersonInfo: true, slug: { notIn: EXCLUDED_CATEGORY_MODULE_SLUGS } },
    select: { id: true, name: true, slug: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return modules;
}

// One person_key per row, with the sorted set of membership-module ids they
// have a non-archived OfficeRecord under. Restricting to membership module
// ids up front means only resolved (person_key IS NOT NULL) records can
// ever appear here -- no separate NULL-filtering needed.
async function personModuleSets(
  client: PrismaClient,
  moduleIds: string[],
  filters: InsightsFilterParams,
): Promise<Array<{ personKey: string; moduleIds: string[] }>> {
  if (moduleIds.length === 0) return [];

  const barangayJoin = filters.barangayCode
    ? Prisma.sql`JOIN "Citizen" c ON c.person_key = t.person_key AND c.person_brgy_code = ${filters.barangayCode}`
    : Prisma.empty;

  const rows = await client.$queryRaw<Array<{ person_key: string; module_ids: string[] }>>(Prisma.sql`
    SELECT t.person_key, array_agg(DISTINCT t.module_id ORDER BY t.module_id) AS module_ids
    FROM "office_record" t
    ${barangayJoin}
    WHERE t.is_archived = false
      AND t.person_key IS NOT NULL
      AND t.module_id = ANY(${moduleIds}::uuid[])
    GROUP BY t.person_key
  `);

  return rows.map((r) => ({ personKey: r.person_key, moduleIds: r.module_ids }));
}

function bucketLabel(moduleIds: string[], modulesInOrder: SankeyModule[]): string {
  const byId = new Map(modulesInOrder.map((m) => [m.id, m.name]));
  const orderIndex = new Map(modulesInOrder.map((m, i) => [m.id, i]));
  const sorted = [...moduleIds].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  return sorted.map((id) => byId.get(id) ?? 'Unknown').join(' + ');
}

// Groups every person's module-set into buckets ("Senior", "Senior +
// Farmer", ...) -- this is what the Sankey renders, and overlapCount (used
// by the summary KPI) is just the sum of every bucket whose set size is 2+.
export async function computeSankeyData(client: PrismaClient, filters: InsightsFilterParams): Promise<SankeyData> {
  const modules = await membershipModules(client);
  const moduleIds = modules.map((m) => m.id);
  const people = await personModuleSets(client, moduleIds, filters);

  const counts = new Map<string, { moduleIds: string[]; count: number }>();
  for (const person of people) {
    const key = [...person.moduleIds].sort().join(',');
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { moduleIds: person.moduleIds, count: 1 });
  }

  const buckets = [...counts.values()]
    .map((b) => ({ moduleIds: b.moduleIds, label: bucketLabel(b.moduleIds, modules), count: b.count }))
    .sort((a, b) => b.count - a.count);

  if (buckets.length <= MAX_SANKEY_BUCKETS) {
    return { modules, buckets };
  }

  const kept = buckets.slice(0, MAX_SANKEY_BUCKETS);
  const foldedCount = buckets.slice(MAX_SANKEY_BUCKETS).reduce((sum, b) => sum + b.count, 0);
  return { modules, buckets: [...kept, { moduleIds: [], label: 'Other combinations', count: foldedCount }] };
}

export async function computeOverlapCount(client: PrismaClient, filters: InsightsFilterParams): Promise<number> {
  const modules = await membershipModules(client);
  const people = await personModuleSets(
    client,
    modules.map((m) => m.id),
    filters,
  );
  return people.filter((p) => p.moduleIds.length >= 2).length;
}

// "Complete" means the master record has enough of its own core fields
// filled in to be useful on its own, independent of which offices have
// touched it -- barangay, sex, civil status, occupation, and birthdate.
export async function computeCompletenessPct(client: PrismaClient): Promise<number> {
  const [total, complete] = await Promise.all([
    client.citizen.count({ where: { isArchived: false } }),
    client.citizen.count({
      where: {
        isArchived: false,
        personBrgyCode: { not: null },
        personSex: { not: null, notIn: [''] },
        personCivilStatus: { not: null, notIn: [''] },
        personOccupation: { not: null, notIn: [''] },
        personBdate: { not: null },
      },
    }),
  ]);
  if (total === 0) return 0;
  return Math.round((complete / total) * 1000) / 10; // one decimal place
}

export async function computeSummary(client: PrismaClient, filters: InsightsFilterParams): Promise<InsightsSummary> {
  const citizenWhere: Prisma.CitizenWhereInput = {
    isArchived: false,
    ...(filters.barangayCode ? { personBrgyCode: filters.barangayCode } : {}),
  };

  const [totalCitizens, totalHouseholds, overlapCount, completenessPct] = await Promise.all([
    client.citizen.count({ where: citizenWhere }),
    client.citizen.count({ where: { ...citizenWhere, personIsHead: true } }),
    computeOverlapCount(client, filters),
    computeCompletenessPct(client),
  ]);

  return { totalCitizens, totalHouseholds, overlapCount, completenessPct };
}

// Magnitude read (population density per barangay), not identity -- counts
// distinct citizens residing there, independent of which offices they've
// registered with.
export async function computeBarangayRanking(
  client: PrismaClient,
  filters: Pick<InsightsFilterParams, 'from' | 'to'>,
): Promise<BarangayRankingRow[]> {
  const dateWhere = monthRangeWhere(filters, 'createdAt');
  const grouped = await client.citizen.groupBy({
    by: ['personBrgyCode'],
    where: { isArchived: false, personBrgyCode: { not: null }, ...dateWhere },
    _count: true,
  });

  const barangays = await client.barangay.findMany({ select: { code: true, name: true } });
  const nameByCode = new Map(barangays.map((b) => [b.code, b.name]));

  return grouped
    .map((g) => ({ code: g.personBrgyCode as string, name: nameByCode.get(g.personBrgyCode as string) ?? 'Unknown', count: g._count }))
    .sort((a, b) => b.count - a.count);
}

function monthRangeWhere(filters: Pick<InsightsFilterParams, 'from' | 'to'>, field: 'createdAt'): Prisma.CitizenWhereInput {
  if (!filters.from && !filters.to) return {};
  const gte = filters.from ? new Date(`${filters.from}-01T00:00:00.000Z`) : undefined;
  const to = filters.to ? new Date(`${filters.to}-01T00:00:00.000Z`) : undefined;
  const lt = to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 1)) : undefined;
  return { [field]: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } as Prisma.CitizenWhereInput;
}

function monthRangeSql(fromCol: Prisma.Sql, filters: Pick<InsightsFilterParams, 'from' | 'to'>): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  // Parenthesized: without them '-01' alone was cast to a date and every
  // month filter failed ("timestamp >= text").
  if (filters.from) parts.push(Prisma.sql`${fromCol} >= ((${filters.from}::text || '-01')::date)`);
  if (filters.to) parts.push(Prisma.sql`${fromCol} < ((${filters.to}::text || '-01')::date + interval '1 month')`);
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

// Two independent monthly counts merged onto one label axis (same "union of
// labels, fill 0" idiom as dashboardWidgets.ts's computeWidgetData) --
// registrations counts every module including Birth/Death (no Citizen
// join, so unresolved/unlinked records still count), merges counts
// approved duplicate-review decisions. Deliberately NOT barangay-filtered:
// joining to Citizen for that would silently drop the Birth/Death rows this
// chart is supposed to include.
export async function computeTrend(client: PrismaClient, filters: Pick<InsightsFilterParams, 'from' | 'to'>): Promise<TrendPoint[]> {
  const registrationRows = await client.$queryRaw<Array<{ month: string; count: bigint }>>(Prisma.sql`
    SELECT to_char(date_trunc('month', t.created_at), 'YYYY-MM') AS month, COUNT(*) AS count
    FROM "office_record" t
    WHERE t.is_archived = false ${monthRangeSql(Prisma.sql`t.created_at`, filters)}
    GROUP BY month ORDER BY month
  `);
  const mergeRows = await client.$queryRaw<Array<{ month: string; count: bigint }>>(Prisma.sql`
    SELECT to_char(date_trunc('month', t.reviewed_at), 'YYYY-MM') AS month, COUNT(*) AS count
    FROM "duplicate_review_queue_item" t
    WHERE t.status = 'approved' AND t.reviewed_at IS NOT NULL ${monthRangeSql(Prisma.sql`t.reviewed_at`, filters)}
    GROUP BY month ORDER BY month
  `);

  const registrationsByMonth = new Map(registrationRows.map((r) => [r.month, Number(r.count)]));
  const mergesByMonth = new Map(mergeRows.map((r) => [r.month, Number(r.count)]));
  const months = [...new Set([...registrationsByMonth.keys(), ...mergesByMonth.keys()])].sort();

  return months.map((month) => ({
    month,
    registrations: registrationsByMonth.get(month) ?? 0,
    merges: mergesByMonth.get(month) ?? 0,
  }));
}

// Drill-down list for a Sankey bucket click -- an EXACT match of the
// requested module-id set (not "at least these"), so clicking "Senior +
// Farmer" doesn't also pull in "Senior + Farmer + PWD".
export async function computeBucketCitizens(
  client: PrismaClient,
  params: InsightsFilterParams & { bucketModuleIds?: string[]; limit?: number },
): Promise<InsightsCitizenRow[]> {
  const modules = await membershipModules(client);
  const moduleIds = modules.map((m) => m.id);
  const people = await personModuleSets(client, moduleIds, params);

  const wantedSet = params.bucketModuleIds ? [...params.bucketModuleIds].sort().join(',') : null;
  const matching = wantedSet ? people.filter((p) => [...p.moduleIds].sort().join(',') === wantedSet) : people;
  const personKeys = matching.slice(0, params.limit ?? 50).map((p) => p.personKey);

  if (personKeys.length === 0) return [];

  const citizens = await client.citizen.findMany({
    where: { personKey: { in: personKeys } },
    select: {
      personKey: true,
      personLname: true,
      personFname: true,
      personIsHead: true,
      personParentKey: true,
      barangay: { select: { name: true } },
    },
    orderBy: [{ personLname: 'asc' }, { personFname: 'asc' }],
  });

  return citizens.map((c) => ({
    personKey: c.personKey,
    personLname: c.personLname,
    personFname: c.personFname,
    barangayName: c.barangay?.name ?? null,
    personIsHead: c.personIsHead,
    personParentKey: c.personParentKey,
  }));
}

// officeId/officeName/accentHue let the Households tree chip each member by office.
export type PersonCategory = { moduleId: string; moduleName: string; officeId: string; officeName: string; accentHue: number };

// Every module a set of person_keys has a non-archived OfficeRecord under
// (Birth/Death included -- unlike the Sankey, a household view is about
// everything touching that person, not the combinatorial-overlap story).
export async function categoriesForPersonKeys(client: PrismaClient, personKeys: string[]): Promise<Map<string, PersonCategory[]>> {
  if (personKeys.length === 0) return new Map();

  const records = await client.officeRecord.findMany({
    where: { personKey: { in: personKeys }, isArchived: false },
    select: { personKey: true, module: { select: { id: true, name: true, office: { select: { id: true, name: true, accentHue: true } } } } },
  });

  const byPerson = new Map<string, PersonCategory[]>();
  for (const r of records) {
    if (!r.personKey) continue;
    const list = byPerson.get(r.personKey) ?? [];
    if (!list.some((c) => c.moduleId === r.module.id)) {
      list.push({
        moduleId: r.module.id,
        moduleName: r.module.name,
        officeId: r.module.office.id,
        officeName: r.module.office.name,
        accentHue: r.module.office.accentHue,
      });
    }
    byPerson.set(r.personKey, list);
  }
  return byPerson;
}
