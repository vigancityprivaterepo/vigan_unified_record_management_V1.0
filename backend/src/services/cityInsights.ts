import { Prisma, type PrismaClient } from '@prisma/client';
import { toGapRule, whereFor } from './programGaps';

// Insights: four questions city officials ask, answered from every office's
// data together (counts only; the names stay on the list pages).
//
// 1. underserved   Which barangays are underserved? Per barangay: residents
//                  in the registry, and distinct people who qualify for a
//                  program but are not in it (every active "Not yet served"
//                  Program gaps rule), as a share of residents.
// 2. reach         Who gets help, and who gets none? Households by how many
//                  programs their members are in, and households with a
//                  senior (60+) or a child under 5 that are in no program.
// 3. pace          Are programs keeping up? Per "Not yet served" rule: the
//                  gap today against the target program's new records per
//                  month (last 3 full months), so how long closing it takes.
// 4. quality       Is the data good enough to trust? Per office: records,
//                  sample records, records about a person with no registry
//                  link, registrations waiting for duplicate review, and
//                  linked people with no barangay / sex / birthdate.
//
// Household = the head's person_key (same as Disaster lists, relief).

const HH = Prisma.raw('CASE WHEN c.person_is_head THEN c.person_key ELSE COALESCE(c.person_parent_key, c.person_key) END');

export type Underserved = {
  rules: Array<{ id: string; name: string }>;
  barangays: Array<{ code: string | null; name: string | null; residents: number; notServed: number; byRule: Record<string, number> }>;
};

export async function underserved(client: PrismaClient): Promise<Underserved> {
  const rows = await client.programGapRule.findMany({ where: { isActive: true, kind: 'missing' }, orderBy: { createdAt: 'asc' } });
  const rules = rows.map(toGapRule);
  const residents = await client.$queryRaw<Array<{ code: string | null; name: string | null; n: number }>>(Prisma.sql`
    SELECT c.person_brgy_code AS code, b.name, COUNT(*)::int AS n
    FROM "Citizen" c LEFT JOIN barangay b ON b.code = c.person_brgy_code
    WHERE NOT c.is_archived GROUP BY 1, 2`);
  const per = new Map<string, Underserved['barangays'][number] & { keys: Set<string> }>();
  const slot = (code: string | null, name: string | null) => {
    const k = code ?? '';
    if (!per.has(k)) per.set(k, { code, name, residents: 0, notServed: 0, byRule: {}, keys: new Set() });
    return per.get(k)!;
  };
  for (const r of residents) slot(r.code, r.name).residents = r.n;
  for (const rule of rules) {
    const hits = await client.$queryRaw<Array<{ person_key: string; code: string | null; name: string | null }>>(Prisma.sql`
      SELECT c.person_key, c.person_brgy_code AS code, b.name
      FROM "Citizen" c LEFT JOIN barangay b ON b.code = c.person_brgy_code
      WHERE ${whereFor(rule, {})}`);
    for (const h of hits) {
      const s = slot(h.code, h.name);
      s.keys.add(h.person_key);
      s.byRule[rule.id] = (s.byRule[rule.id] ?? 0) + 1;
    }
  }
  const barangays = [...per.values()]
    .map(({ keys, ...b }) => ({ ...b, notServed: keys.size }))
    .filter((b) => b.residents > 0 || b.notServed > 0)
    .sort((a, b) => b.notServed / Math.max(1, b.residents) - a.notServed / Math.max(1, a.residents) || b.notServed - a.notServed);
  return { rules: rules.map((r) => ({ id: r.id, name: r.name })), barangays };
}

export type Reach = {
  households: number;
  byPrograms: Array<{ bucket: '0' | '1' | '2-3' | '4+'; households: number }>;
  vulnerableNone: number;
  vulnerableNoneByBarangay: Array<{ name: string | null; households: number }>;
};

export async function reach(client: PrismaClient): Promise<Reach> {
  const base = Prisma.sql`
    WITH members AS (
      SELECT ${HH} AS hh, c.person_key, c.person_brgy_code,
        date_part('year', age(c.person_bdate))::int AS age
      FROM "Citizen" c
      WHERE NOT c.is_archived
        AND NOT EXISTS (SELECT 1 FROM office_record d JOIN office_module dm ON dm.id = d.module_id
                        WHERE d.person_key = c.person_key AND NOT d.is_archived AND dm.slug = 'death')
    ),
    hh AS (
      SELECT m.hh,
        (SELECT COUNT(DISTINCT r.module_id) FROM office_record r JOIN members x ON x.person_key = r.person_key
          WHERE x.hh = m.hh AND NOT r.is_archived) AS programs,
        bool_or(m.age >= 60 OR m.age < 5) AS vulnerable,
        (array_agg(m.person_brgy_code ORDER BY (m.person_key = m.hh) DESC))[1] AS brgy
      FROM members m GROUP BY m.hh
    )`;
  const [buckets, none] = await Promise.all([
    client.$queryRaw<Array<{ bucket: string; n: number }>>(Prisma.sql`${base}
      SELECT CASE WHEN programs = 0 THEN '0' WHEN programs = 1 THEN '1' WHEN programs <= 3 THEN '2-3' ELSE '4+' END AS bucket, COUNT(*)::int AS n
      FROM hh GROUP BY 1`),
    client.$queryRaw<Array<{ name: string | null; n: number }>>(Prisma.sql`${base}
      SELECT b.name, COUNT(*)::int AS n FROM hh LEFT JOIN barangay b ON b.code = hh.brgy
      WHERE hh.vulnerable AND hh.programs = 0 GROUP BY 1 ORDER BY 2 DESC, 1`),
  ]);
  const order = ['0', '1', '2-3', '4+'] as const;
  return {
    households: buckets.reduce((a, b) => a + b.n, 0),
    byPrograms: order.map((bucket) => ({ bucket, households: buckets.find((b) => b.bucket === bucket)?.n ?? 0 })),
    vulnerableNone: none.reduce((a, b) => a + b.n, 0),
    vulnerableNoneByBarangay: none.slice(0, 10).map((r) => ({ name: r.name, households: r.n })),
  };
}

export type Pace = Array<{ id: string; name: string; program: string; office: string; gap: number; perMonth: number; months: number | null }>;

export async function pace(client: PrismaClient): Promise<Pace> {
  const rows = await client.programGapRule.findMany({
    where: { isActive: true, kind: 'missing' },
    include: { targetModule: { select: { name: true, office: { select: { name: true, shortName: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  const out: Pace = [];
  for (const row of rows) {
    const rule = toGapRule(row);
    const [gap] = await client.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(*)::int AS n FROM "Citizen" c WHERE ${whereFor(rule, {})}`);
    const [added] = await client.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM office_record
      WHERE module_id = ${rule.targetModuleId}::uuid AND NOT is_archived
        AND created_at >= date_trunc('month', now()) - interval '3 months' AND created_at < date_trunc('month', now())`);
    const perMonth = Math.round(((added?.n ?? 0) / 3) * 10) / 10;
    const g = gap?.n ?? 0;
    out.push({
      id: rule.id, name: rule.name, program: row.targetModule.name, office: row.targetModule.office.shortName || row.targetModule.office.name,
      gap: g, perMonth, months: g === 0 ? 0 : perMonth > 0 ? Math.ceil(g / perMonth) : null,
    });
  }
  return out;
}

export type Quality = Array<{
  officeId: string; office: string; records: number; sample: number; unlinked: number; pendingReview: number;
  noBarangay: number; noSex: number; noBirthdate: number;
}>;

export async function quality(client: PrismaClient): Promise<Quality> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT o.id, COALESCE(o.short_name, o.name) AS office,
      COUNT(r.record_key)::int AS records,
      COUNT(r.record_key) FILTER (WHERE r.data->>'_sample' = 'true')::int AS sample,
      COUNT(r.record_key) FILTER (WHERE m.collect_person_info AND r.person_key IS NULL)::int AS unlinked,
      COUNT(DISTINCT c.person_key) FILTER (WHERE c.person_brgy_code IS NULL)::int AS no_barangay,
      COUNT(DISTINCT c.person_key) FILTER (WHERE c.person_sex IS NULL OR c.person_sex = '')::int AS no_sex,
      COUNT(DISTINCT c.person_key) FILTER (WHERE c.person_bdate IS NULL)::int AS no_birthdate,
      (SELECT COUNT(*)::int FROM duplicate_review_queue_item q JOIN office_module qm ON qm.id = q.module_id
        WHERE qm.office_id = o.id AND q.status = 'pending') AS pending
    FROM office o
    JOIN office_module m ON m.office_id = o.id
    LEFT JOIN office_record r ON r.module_id = m.id AND NOT r.is_archived
    LEFT JOIN "Citizen" c ON c.person_key = r.person_key AND NOT c.is_archived
    WHERE o.is_active
    GROUP BY o.id, o.short_name, o.name
    ORDER BY 2`);
  return rows.map((r) => ({
    officeId: r.id as string, office: r.office as string, records: r.records as number, sample: r.sample as number,
    unlinked: r.unlinked as number, pendingReview: r.pending as number,
    noBarangay: r.no_barangay as number, noSex: r.no_sex as number, noBirthdate: r.no_birthdate as number,
  }));
}
