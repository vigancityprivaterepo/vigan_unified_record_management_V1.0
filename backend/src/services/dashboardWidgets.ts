import { Prisma, type PrismaClient } from '@prisma/client';

export type ChartType = 'bar' | 'line' | 'donut' | 'number';
export type WidgetDataRow = { label: string | null; count: number };

// One row per group-by label, one count per selected module (aligned by
// index to the `moduleIds` passed into computeWidgetData) -- lets a chart
// show "seniors vs. PWDs vs. farmers, by barangay" as one series per
// module sharing a barangay axis, instead of one module's data alone.
export type WidgetSeriesRow = { label: string | null; counts: number[] };

// Narrows a widget's underlying query without being a chart axis itself --
// distinct from groupBy, which always breaks every value of a dimension
// out as its own bar/line/label. "Farmers in just Barangay X" is a filter;
// "Farmers by barangay" (every barangay shown) is a groupBy.
export type WidgetFilters = { barangayCode?: string; sex?: string; month?: string; fieldKey?: string; fieldValue?: string };

const MAX_GROUP_BY_DIMENSIONS = 2;

// 'count' = number of records; 'sum:<fieldKey>' = total of a NUMBER field.
// Values that aren't plain numbers (blank, typos) are skipped, not errors.
export function measureSql(measure: string): Prisma.Sql {
  // Distinct people, not records -- one person can get assistance many times.
  if (measure === 'people') return Prisma.sql`COUNT(DISTINCT t.person_key)`;
  if (measure.startsWith('sum:')) {
    const key = measure.slice('sum:'.length);
    return Prisma.sql`COALESCE(SUM(CASE WHEN (t.data ->> ${key}) ~ '^-?[0-9]+([.][0-9]+)?$' THEN (t.data ->> ${key})::numeric END), 0)`;
  }
  return Prisma.sql`COUNT(*)`;
}

type DimensionSql = { expr: Prisma.Sql; needsCitizen: boolean; needsBarangay: boolean };

// Turns one group-by dimension name into its SQL expression -- the five
// kinds every single-dimension groupBy has always supported ('barangay',
// 'sex', 'month', 'age_bracket', 'field:<key>'), composable so 1-2 of them
// can combine into one query.
export function dimensionSql(dim: string): DimensionSql {
  if (dim === 'barangay') {
    return { expr: Prisma.sql`COALESCE(b.name, 'No barangay')`, needsCitizen: true, needsBarangay: true };
  }
  if (dim === 'sex') {
    return { expr: Prisma.sql`COALESCE(NULLIF(TRIM(c.person_sex), ''), 'Unknown')`, needsCitizen: true, needsBarangay: false };
  }
  if (dim === 'month') {
    return { expr: Prisma.sql`to_char(date_trunc('month', t.created_at), 'YYYY-MM')`, needsCitizen: false, needsBarangay: false };
  }
  if (dim === 'age_bracket') {
    // 10-year bands off today's age ("20-29", "30-39", ...) -- grouping by
    // exact birthdate would produce one bucket per person, so this is the
    // only sensible age dimension. 'Unknown' when birthdate isn't on file.
    return {
      expr: Prisma.sql`CASE WHEN c.person_bdate IS NULL THEN 'Unknown' ELSE
        (FLOOR(DATE_PART('year', AGE(c.person_bdate)) / 10) * 10)::int::text || '-' ||
        ((FLOOR(DATE_PART('year', AGE(c.person_bdate)) / 10) * 10) + 9)::int::text
      END`,
      needsCitizen: true,
      needsBarangay: false,
    };
  }
  if (dim === 'other_programs') {
    // Which OTHER programs of the same office this person is also in, e.g.
    // an AICS record for someone who is also in Senior Citizen and PWD ->
    // "PWD + Senior Citizen". Looked up live, never copied onto the record.
    return {
      expr: Prisma.sql`COALESCE((
        SELECT string_agg(DISTINCT m2.name, ' + ' ORDER BY m2.name)
        FROM office_record r2
        JOIN office_module m2 ON m2.id = r2.module_id
        WHERE r2.person_key = t.person_key AND r2.is_archived = false AND r2.module_id <> t.module_id
          AND m2.office_id = (SELECT m1.office_id FROM office_module m1 WHERE m1.id = t.module_id)
      ), CASE WHEN t.person_key IS NULL THEN 'Not linked' ELSE 'Not enrolled in other programs' END)`,
      needsCitizen: false,
      needsBarangay: false,
    };
  }
  if (dim.startsWith('field:')) {
    // The JSONB key is passed as a bind parameter, never concatenated into
    // the SQL string -- it's admin-typed (as a field label, later
    // slugified), not a fixed whitelist like the other dimensions.
    const key = dim.slice('field:'.length);
    return { expr: Prisma.sql`COALESCE(t.data ->> ${key}, '(blank)')`, needsCitizen: false, needsBarangay: false };
  }
  throw new Error(`Unknown group-by dimension: ${dim}`);
}

// Filter WHERE fragments -- barangay/sex compare Citizen columns directly
// (no join to the barangay table needed, unlike the barangay-name
// *dimension* above which displays the name); month compares office_record's
// own created_at, no Citizen join needed at all.
export function filterSql(filters: WidgetFilters): { needsCitizen: boolean; clauses: Prisma.Sql[] } {
  const clauses: Prisma.Sql[] = [];
  let needsCitizen = false;
  if (filters.barangayCode) {
    clauses.push(Prisma.sql`c.person_brgy_code = ${filters.barangayCode}`);
    needsCitizen = true;
  }
  if (filters.sex) {
    clauses.push(Prisma.sql`TRIM(c.person_sex) = ${filters.sex}`);
    needsCitizen = true;
  }
  if (filters.month) {
    clauses.push(Prisma.sql`to_char(date_trunc('month', t.created_at), 'YYYY-MM') = ${filters.month}`);
  }
  if (filters.fieldKey && filters.fieldValue !== undefined) {
    // Case-insensitive: older intake uppercased dropdown values ("WALK-IN").
    clauses.push(Prisma.sql`upper(t.data ->> ${filters.fieldKey}) = upper(${filters.fieldValue})`);
  }
  return { needsCitizen, clauses };
}

// Runs one module's grouped count query -- the actual "recipe" (0-2
// group-by dimensions + optional filters) applied to office_record, scoped
// to a single module_id. Every module stores its records the same way, so
// this is the one query shape that covers every office -- CSWD/Agriculture/
// Civil Registry included. With 2 dimensions, the row label is their
// composite ("Poblacion / M") rather than a single value.
async function computeModuleRows(
  client: PrismaClient,
  moduleId: string,
  groupBy: string[],
  filters: WidgetFilters,
  measure = 'count',
): Promise<WidgetDataRow[]> {
  const agg = measureSql(measure);
  const { needsCitizen: filterNeedsCitizen, clauses: filterClauses } = filterSql(filters);
  const filterSqlFragment = filterClauses.length ? Prisma.sql`AND ${Prisma.join(filterClauses, ' AND ')}` : Prisma.empty;

  if (groupBy.length === 0) {
    const joinSql = filterNeedsCitizen ? Prisma.sql`JOIN "Citizen" c ON c.person_key = t.person_key AND c.is_archived = false` : Prisma.empty;
    const rows = await client.$queryRaw<Array<{ count: unknown }>>(Prisma.sql`
      SELECT ${agg} AS count FROM "office_record" t
      ${joinSql}
      WHERE t.is_archived = false AND t.module_id = ${moduleId}::uuid ${filterSqlFragment}
    `);
    return [{ label: 'Total', count: Number(String(rows[0]?.count ?? 0)) }];
  }

  const dims = groupBy.slice(0, MAX_GROUP_BY_DIMENSIONS).map(dimensionSql);
  const needsCitizen = filterNeedsCitizen || dims.some((d) => d.needsCitizen);
  const needsBarangay = dims.some((d) => d.needsBarangay);

  // Column aliases (dim0, dim1) are our own fixed strings, never derived
  // from admin input -- safe to splice in as raw SQL identifiers.
  const selectCols = Prisma.join(
    dims.map((d, i) => Prisma.sql`${d.expr} AS ${Prisma.raw(`dim${i}`)}`),
    ', ',
  );
  const groupCols = Prisma.join(
    dims.map((_, i) => Prisma.raw(`dim${i}`)),
    ', ',
  );
  const joinSql = needsCitizen ? Prisma.sql`JOIN "Citizen" c ON c.person_key = t.person_key AND c.is_archived = false` : Prisma.empty;
  const barangayJoinSql = needsBarangay ? Prisma.sql`LEFT JOIN barangay b ON b.code = c.person_brgy_code` : Prisma.empty;

  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT ${selectCols}, ${agg} AS count
    FROM "office_record" t
    ${joinSql}
    ${barangayJoinSql}
    WHERE t.is_archived = false AND t.module_id = ${moduleId}::uuid ${filterSqlFragment}
    GROUP BY ${groupCols}
    ORDER BY count DESC
  `);

  return rows.map((r) => ({
    label: dims.map((_, i) => String(r[`dim${i}`] ?? '')).join(' / '),
    count: Number(String(r.count ?? 0)),
  }));
}

// Runs every selected module's query, then merges them into one label axis
// (union of every module's own labels) so a chart can plot one series per
// module -- consolidating, say, CSWD's three modules and Agriculture's
// Farmer module onto the same barangay breakdown.
export async function computeWidgetData(
  client: PrismaClient,
  widget: { moduleIds: string[]; groupBy: string[]; filters?: WidgetFilters; measure?: string },
): Promise<WidgetSeriesRow[]> {
  const filters = widget.filters ?? {};
  const perModule = await Promise.all(
    widget.moduleIds.map((moduleId) => computeModuleRows(client, moduleId, widget.groupBy, filters, widget.measure)),
  );

  // "Total" (no group-by, chartType 'number') -- one row, one count per
  // module, same shape as the grouped case below so the frontend doesn't
  // need a separate code path.
  if (widget.groupBy.length === 0) {
    return [{ label: 'Total', counts: perModule.map((rows) => rows[0]?.count ?? 0) }];
  }

  const labels = [...new Set(perModule.flatMap((rows) => rows.map((r) => r.label)))];
  return labels.map((label) => ({
    label,
    counts: perModule.map((rows) => rows.find((r) => r.label === label)?.count ?? 0),
  }));
}
