import { Prisma, type PrismaClient } from '@prisma/client';

// Backs the admin City overview: record counts per office per month, and per
// barangay per office, so every chart can color by office. Separate from
// insights.ts's computeTrend (which is office-agnostic) rather than widening
// that one, so the existing Insights page keeps its exact contract.
export type OfficeBreakdownOffice = { id: string; name: string; slug: string; accentHue: number; icon: string };
export type OfficeBreakdown = {
  offices: OfficeBreakdownOffice[];
  moduleOffice: Record<string, string>;
  months: Array<{ month: string; counts: Record<string, number> }>;
  barangays: Array<{ code: string; name: string; total: number; counts: Record<string, number> }>;
};
export type OfficeBreakdownFilters = { barangayCode?: string; from?: string; to?: string };

function rangeSql(col: Prisma.Sql, f: OfficeBreakdownFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.from) parts.push(Prisma.sql`${col} >= (${f.from} || '-01')::date`);
  if (f.to) parts.push(Prisma.sql`${col} < ((${f.to} || '-01')::date + interval '1 month')`);
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

export async function computeOfficeBreakdown(client: PrismaClient, filters: OfficeBreakdownFilters): Promise<OfficeBreakdown> {
  const [offices, modules] = await Promise.all([
    client.office.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true, accentHue: true, icon: true }, orderBy: { name: 'asc' } }),
    client.officeModule.findMany({ select: { id: true, officeId: true } }),
  ]);

  // Barangay filter necessarily drops unlinked records (e.g. out-of-town
  // births) -- same trade-off insights.ts documents for its own filters.
  const brgyJoin = filters.barangayCode
    ? Prisma.sql`JOIN "Citizen" c ON c.person_key = r.person_key AND c.person_brgy_code = ${filters.barangayCode}`
    : Prisma.empty;

  const monthRows = await client.$queryRaw<Array<{ month: string; office_id: string; count: bigint }>>(Prisma.sql`
    SELECT to_char(date_trunc('month', r.created_at), 'YYYY-MM') AS month, m.office_id, COUNT(*) AS count
    FROM "office_record" r
    JOIN "office_module" m ON m.id = r.module_id
    ${brgyJoin}
    WHERE r.is_archived = false ${rangeSql(Prisma.sql`r.created_at`, filters)}
    GROUP BY 1, 2
    ORDER BY 1
  `);

  const brgyRows = await client.$queryRaw<Array<{ code: string; name: string; office_id: string; count: bigint }>>(Prisma.sql`
    SELECT b.code, b.name, m.office_id, COUNT(*) AS count
    FROM "office_record" r
    JOIN "office_module" m ON m.id = r.module_id
    JOIN "Citizen" c ON c.person_key = r.person_key
    JOIN "barangay" b ON b.code = c.person_brgy_code
    WHERE r.is_archived = false ${rangeSql(Prisma.sql`r.created_at`, filters)}
    GROUP BY b.code, b.name, m.office_id
  `);

  const months = new Map<string, Record<string, number>>();
  for (const row of monthRows) {
    const bucket = months.get(row.month) ?? {};
    bucket[row.office_id] = Number(row.count);
    months.set(row.month, bucket);
  }

  const brgys = new Map<string, { code: string; name: string; total: number; counts: Record<string, number> }>();
  for (const row of brgyRows) {
    const b = brgys.get(row.code) ?? { code: row.code, name: row.name, total: 0, counts: {} };
    b.counts[row.office_id] = Number(row.count);
    b.total += Number(row.count);
    brgys.set(row.code, b);
  }

  return {
    offices,
    moduleOffice: Object.fromEntries(modules.map((m) => [m.id, m.officeId])),
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, counts]) => ({ month, counts })),
    barangays: [...brgys.values()].sort((a, b) => b.total - a.total).slice(0, 12),
  };
}
