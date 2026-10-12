import { Prisma, type PrismaClient } from '@prisma/client';
import { dimensionSql, filterSql, measureSql, type WidgetFilters } from './dashboardWidgets';

// What is behind a saved chart, for someone checking the numbers:
//   records  the actual records a chart (or one bar / slice / month of it) counts
//   history  the same selection month by month, with summary figures
//   profile  what each source program collects, field by field, and how
//            completely it is filled in
// All three apply the chart's own filters with the same SQL as the chart
// (services/dashboardWidgets.ts), so a bar that says 12 opens 12 records.

export type Recipe = { groupBy: string[]; measure: string; filters: WidgetFilters };

const NUMERIC = Prisma.raw(`'^-?[0-9]+([.][0-9]+)?$'`);
export const RECORDS_PAGE_SIZE = 20;
export const EXPORT_LIMIT = 5000;
// Profiling reads every field of every record; past this many it reads the newest only.
const PROFILE_LIMIT = 20000;

// FROM + WHERE for one source program, narrowed to one group of the chart
// when `label` is given (the text on that bar, slice or point).
function scope(recipe: Recipe, moduleId: string, label?: string): Prisma.Sql {
  const dims = recipe.groupBy.slice(0, 2).map(dimensionSql);
  const filter = filterSql(recipe.filters);
  const where: Prisma.Sql[] = [Prisma.sql`t.is_archived = false`, Prisma.sql`t.module_id = ${moduleId}::uuid`, ...filter.clauses];
  // The chart inner-joins the registry whenever it groups or filters by a
  // person's details, so records with no registry link are not in it.
  if (filter.needsCitizen || dims.some((d) => d.needsCitizen)) where.push(Prisma.sql`c.person_key IS NOT NULL`);
  if (label !== undefined && dims.length > 0) {
    const text = Prisma.join(dims.map((d) => Prisma.sql`COALESCE((${d.expr})::text, '')`), ` || ' / ' || `);
    where.push(Prisma.sql`(${text}) = ${label}`);
  }
  return Prisma.sql`
    FROM office_record t
    LEFT JOIN "Citizen" c ON c.person_key = t.person_key AND c.is_archived = false
    LEFT JOIN barangay b ON b.code = c.person_brgy_code
    WHERE ${Prisma.join(where, ' AND ')}`;
}

export type ExploreColumn = { key: string; label: string; type: string };
export type ExploreRecord = {
  id: string; addedOn: string; person: string | null; barangay: string | null; sex: string | null; age: number | null;
  sample: boolean; values: Record<string, unknown>;
};

export async function columnsFor(client: PrismaClient, moduleId: string): Promise<ExploreColumn[]> {
  const fields = await client.officeFormField.findMany({ where: { moduleId }, orderBy: { sortOrder: 'asc' } });
  return fields.filter((f) => f.fieldType !== 'FILE').map((f) => ({ key: f.key, label: f.label, type: f.fieldType }));
}

export async function records(
  client: PrismaClient, recipe: Recipe, moduleId: string, label: string | undefined, page: { limit: number; offset: number },
): Promise<{ total: number; items: ExploreRecord[] }> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT t.record_key, t.created_at, t.data, t.unresolved_person, c.person_lname, c.person_fname, c.person_sex,
      date_part('year', age(c.person_bdate))::int AS age, b.name AS barangay, COUNT(*) OVER ()::int AS total
    ${scope(recipe, moduleId, label)}
    ORDER BY t.created_at DESC, t.record_key
    LIMIT ${page.limit} OFFSET ${page.offset}`);
  return {
    total: (rows[0]?.total as number | undefined) ?? 0,
    items: rows.map((r) => {
      const { _sample, ...values } = (r.data ?? {}) as Record<string, unknown>;
      const unresolved = r.unresolved_person as { lname?: string; fname?: string } | null;
      return {
        id: r.record_key as string,
        addedOn: (r.created_at as Date).toISOString().slice(0, 10),
        person: r.person_lname ? `${r.person_lname}, ${r.person_fname}` : unresolved?.lname ? `${unresolved.lname}, ${unresolved.fname ?? ''} (not linked)` : null,
        barangay: r.barangay as string | null,
        sex: r.person_sex as string | null,
        age: r.age as number | null,
        sample: _sample === true || _sample === 'true',
        values,
      };
    }),
  };
}

export type ExploreSummary = {
  moduleId: string; records: number; people: number; first: string | null; last: string | null;
  // Only when the chart totals a number field.
  sum: number | null; average: number | null; median: number | null; min: number | null; max: number | null;
};

// Month by month for the last two years, one value per source program
// (aligned to `moduleIds`), using the chart's own measure.
export async function history(
  client: PrismaClient, recipe: Recipe, moduleIds: string[], label: string | undefined,
): Promise<{ months: Array<{ month: string; values: number[] }>; summary: ExploreSummary[] }> {
  const sumKey = recipe.measure.startsWith('sum:') ? recipe.measure.slice(4) : null;
  const num = sumKey ? Prisma.sql`CASE WHEN (t.data ->> ${sumKey}) ~ ${NUMERIC} THEN (t.data ->> ${sumKey})::numeric END` : Prisma.sql`NULL::numeric`;
  const perModule = await Promise.all(moduleIds.map(async (moduleId) => {
    const from = scope(recipe, moduleId, label);
    const [monthly, totals] = await Promise.all([
      client.$queryRaw<Array<{ month: string; value: unknown }>>(Prisma.sql`
        SELECT to_char(date_trunc('month', t.created_at), 'YYYY-MM') AS month, ${measureSql(recipe.measure)} AS value
        ${from} AND t.created_at >= date_trunc('month', now()) - interval '23 months'
        GROUP BY 1`),
      client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(*)::int AS records, COUNT(DISTINCT t.person_key)::int AS people,
          min(t.created_at) AS first, max(t.created_at) AS last,
          SUM(${num}) AS sum, AVG(${num}) AS average, MIN(${num}) AS min, MAX(${num}) AS max,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ${num}) AS median
        ${from}`),
    ]);
    return { moduleId, monthly, totals: totals[0] ?? {} };
  }));

  const seen = perModule.flatMap((m) => m.monthly.map((r) => r.month)).sort();
  const months: Array<{ month: string; values: number[] }> = [];
  if (seen.length > 0) {
    // Every month from the first with data to this one, so a quiet month shows as 0.
    const now = new Date();
    let [y, m] = (seen[0] as string).split('-').map(Number) as [number, number];
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      months.push({ month, values: perModule.map((pm) => Number(String(pm.monthly.find((r) => r.month === month)?.value ?? 0))) });
      if (++m > 12) { m = 1; y++; }
    }
  }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(String(v)));
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
  return {
    months,
    summary: perModule.map(({ moduleId, totals: t }) => ({
      moduleId, records: (t.records as number | undefined) ?? 0, people: (t.people as number | undefined) ?? 0, first: day(t.first), last: day(t.last),
      sum: sumKey ? n(t.sum) : null, average: sumKey ? n(t.average) : null, median: sumKey ? n(t.median) : null, min: sumKey ? n(t.min) : null, max: sumKey ? n(t.max) : null,
    })),
  };
}

export type FieldProfile = {
  key: string; label: string; type: string; options: number;
  filled: number; distinct: number; min: number | null; max: number | null; average: number | null;
};
export type ModuleProfile = {
  moduleId: string; records: number; profiled: number; sample: number; people: number; notLinked: number;
  aboutPeople: boolean; first: string | null; last: string | null; fields: FieldProfile[];
};

// The whole program, not just what the chart filters to: this answers "what
// does this program collect and how complete is it".
export async function profile(client: PrismaClient, moduleId: string): Promise<ModuleProfile> {
  const [module, fields, totals, perField] = await Promise.all([
    client.officeModule.findUnique({ where: { id: moduleId }, select: { collectPersonInfo: true } }),
    client.officeFormField.findMany({ where: { moduleId }, orderBy: { sortOrder: 'asc' } }),
    client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT COUNT(*)::int AS records, COUNT(*) FILTER (WHERE data->>'_sample' = 'true')::int AS sample,
        COUNT(DISTINCT person_key)::int AS people, COUNT(*) FILTER (WHERE person_key IS NULL)::int AS not_linked,
        min(created_at) AS first, max(created_at) AS last
      FROM office_record WHERE is_archived = false AND module_id = ${moduleId}::uuid`),
    client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT e.key, COUNT(*) FILTER (WHERE e.value IS NOT NULL AND e.value <> '' AND e.value <> '[]')::int AS filled,
        COUNT(DISTINCT e.value)::int AS distinct_values,
        MIN(n.num) AS min, MAX(n.num) AS max, AVG(n.num) AS average
      FROM (SELECT data FROM office_record WHERE is_archived = false AND module_id = ${moduleId}::uuid
            ORDER BY created_at DESC LIMIT ${PROFILE_LIMIT}) t
      CROSS JOIN LATERAL jsonb_each_text(t.data) e
      CROSS JOIN LATERAL (SELECT CASE WHEN e.value ~ ${NUMERIC} THEN e.value::numeric END AS num) n
      GROUP BY e.key`),
  ]);
  const t = totals[0] ?? {};
  const byKey = new Map(perField.map((r) => [r.key as string, r]));
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(String(v)));
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
  const recordsTotal = (t.records as number | undefined) ?? 0;
  return {
    moduleId, records: recordsTotal, profiled: Math.min(recordsTotal, PROFILE_LIMIT), sample: (t.sample as number | undefined) ?? 0,
    people: (t.people as number | undefined) ?? 0, notLinked: (t.not_linked as number | undefined) ?? 0,
    aboutPeople: module?.collectPersonInfo ?? true, first: day(t.first), last: day(t.last),
    fields: fields.filter((f) => f.fieldType !== 'FILE').map((f) => {
      const r = byKey.get(f.key);
      const numeric = f.fieldType === 'NUMBER';
      return {
        key: f.key, label: f.label, type: f.fieldType, options: f.options.length,
        filled: (r?.filled as number | undefined) ?? 0, distinct: (r?.distinct_values as number | undefined) ?? 0,
        min: numeric ? n(r?.min) : null, max: numeric ? n(r?.max) : null, average: numeric ? n(r?.average) : null,
      };
    }),
  };
}
