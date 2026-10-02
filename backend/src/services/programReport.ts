import { Prisma, type PrismaClient } from '@prisma/client';

// Summary report for one program over a date range: the counts most agency
// reports are built from. Not an official form; official layouts can be
// added once the offices supply them.
//
// - Period: records registered (created_at) from `from` to `to`, inclusive.
// - Person details come from the linked registry citizen, or, for records
//   saved without a link, from the name the office recorded.
// - Age group at the end of the period: children 0-17, adults 18-59,
//   seniors 60+.
// Counts only; no names.

export type ProgramReport = {
  from: string; to: string;
  total: number; people: number; notLinked: number; sample: number;
  bySex: Array<{ name: string; count: number }>;
  byAge: Array<{ name: string; count: number }>;
  byBarangay: Array<{ name: string; count: number }>;
  byMonth: Array<{ month: string; count: number }>;
};

export async function programReport(client: PrismaClient, moduleId: string, from: string, to: string): Promise<ProgramReport> {
  const base = Prisma.sql`
    WITH rec AS (
      SELECT r.record_key, r.person_key, r.created_at, r.data->>'_sample' = 'true' AS sample,
        COALESCE(NULLIF(upper(c.person_sex), ''), NULLIF(upper(r.unresolved_person->>'sex'), '')) AS sex,
        COALESCE(c.person_bdate,
          CASE WHEN r.unresolved_person->>'bdate' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(r.unresolved_person->>'bdate', 10)::date END) AS bdate,
        b.name AS barangay
      FROM office_record r
      LEFT JOIN "Citizen" c ON c.person_key = r.person_key
      LEFT JOIN barangay b ON b.code = c.person_brgy_code
      WHERE r.module_id = ${moduleId}::uuid AND NOT r.is_archived
        AND r.created_at >= ${from}::date AND r.created_at < (${to}::date + interval '1 day')
    )`;
  const [totals, sex, age, brgy, month] = await Promise.all([
    client.$queryRaw<Array<{ total: number; people: number; not_linked: number; sample: number }>>(Prisma.sql`${base}
      SELECT COUNT(*)::int AS total, COUNT(DISTINCT person_key)::int AS people,
        COUNT(*) FILTER (WHERE person_key IS NULL)::int AS not_linked, COUNT(*) FILTER (WHERE sample)::int AS sample FROM rec`),
    client.$queryRaw<Array<{ name: string; count: number }>>(Prisma.sql`${base}
      SELECT CASE sex WHEN 'M' THEN 'Male' WHEN 'F' THEN 'Female' ELSE 'Not recorded' END AS name, COUNT(*)::int AS count
      FROM rec GROUP BY 1 ORDER BY 1`),
    client.$queryRaw<Array<{ name: string; count: number }>>(Prisma.sql`${base}
      SELECT CASE WHEN bdate IS NULL THEN 'Not recorded'
                  WHEN date_part('year', age(${to}::date, bdate)) < 18 THEN 'Children (0-17)'
                  WHEN date_part('year', age(${to}::date, bdate)) < 60 THEN 'Adults (18-59)'
                  ELSE 'Seniors (60+)' END AS name, COUNT(*)::int AS count
      FROM rec GROUP BY 1`),
    client.$queryRaw<Array<{ name: string | null; count: number }>>(Prisma.sql`${base}
      SELECT barangay AS name, COUNT(*)::int AS count FROM rec GROUP BY 1 ORDER BY 2 DESC, 1`),
    client.$queryRaw<Array<{ month: string; count: number }>>(Prisma.sql`${base}
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS count FROM rec GROUP BY 1 ORDER BY 1`),
  ]);
  const t = totals[0] ?? { total: 0, people: 0, not_linked: 0, sample: 0 };
  const ageOrder = ['Children (0-17)', 'Adults (18-59)', 'Seniors (60+)', 'Not recorded'];
  return {
    from, to,
    total: t.total, people: t.people, notLinked: t.not_linked, sample: t.sample,
    bySex: sex,
    byAge: ageOrder.map((name) => ({ name, count: age.find((a) => a.name === name)?.count ?? 0 })).filter((a) => a.count > 0 || a.name !== 'Not recorded'),
    byBarangay: brgy.map((b) => ({ name: b.name ?? 'No barangay', count: b.count })),
    byMonth: month,
  };
}
