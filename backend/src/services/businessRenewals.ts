import { Prisma, type PrismaClient } from '@prisma/client';

// Business renewals (BPLO): which businesses have not renewed their permit,
// from the Business Permits program (module slug 'business_permits', one
// record per business; permit_year = the latest year a permit was issued).
//
//   renewed            last permit year = this year
//   not renewed        last permit year = last year (most likely still
//                      operating: the main follow-up list)
//   lapsed longer      last permit year before last year (many may have
//                      closed)
//   no permit year     no permit_year on the record
//
// BPLS status codes (bpls_status_code) are shown and filterable as-is: their
// meaning has not been confirmed by BPLO yet, so nothing is excluded by code.
// No peso amounts are estimated: the data has no tax due per business.

export const BUSINESS_PERMITS_SLUG = 'business_permits';

export type RenewalFilters = {
  // 'none' = records without a permit year
  lastYear?: number | 'none';
  barangay?: string;
  line?: string;
  statusCode?: string;
  q?: string;
};

export type RenewalSummary = {
  year: number;
  total: number;
  renewed: number;
  notRenewed: number;
  lapsedLonger: number;
  noYear: number;
  byYear: Array<{ year: number | null; count: number }>;
  byStatusCode: Array<{ code: string | null; count: number; renewed: number }>;
  notRenewedByBarangay: Array<{ name: string | null; count: number }>;
  notRenewedByLine: Array<{ name: string | null; count: number }>;
};

export type RenewalBusiness = {
  recordId: string;
  businessName: string | null;
  tradeName: string | null;
  tan: string | null;
  line: string | null;
  barangay: string | null;
  lastYear: number | null;
  validUntil: string | null;
  permitNo: string | null;
  statusCode: string | null;
};

const YEAR = Prisma.sql`(CASE WHEN r.data->>'permit_year' ~ '^\\d{4}$' THEN (r.data->>'permit_year')::int END)`;

function base(): Prisma.Sql {
  return Prisma.sql`
    FROM office_record r JOIN office_module m ON m.id = r.module_id
    WHERE m.slug = ${BUSINESS_PERMITS_SLUG} AND NOT r.is_archived`;
}

function filterSql(f: RenewalFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.lastYear === 'none') parts.push(Prisma.sql`${YEAR} IS NULL`);
  else if (typeof f.lastYear === 'number') parts.push(Prisma.sql`${YEAR} = ${f.lastYear}`);
  if (f.barangay) parts.push(Prisma.sql`r.data->>'business_barangay' = ${f.barangay}`);
  if (f.line) parts.push(Prisma.sql`r.data->>'line_of_business' = ${f.line}`);
  if (f.statusCode) parts.push(Prisma.sql`r.data->>'bpls_status_code' = ${f.statusCode}`);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(Prisma.sql`(r.data->>'business_name' ILIKE ${like} OR r.data->>'trade_name' ILIKE ${like} OR r.data->>'tan_taxpayer_account_no' ILIKE ${like})`);
  }
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

export async function summarizeRenewals(client: PrismaClient, year = new Date().getFullYear()): Promise<RenewalSummary> {
  const [byYear, byCode, brgy, lines] = await Promise.all([
    client.$queryRaw<Array<{ year: number | null; count: number }>>(Prisma.sql`
      SELECT ${YEAR} AS year, COUNT(*)::int AS count ${base()} GROUP BY 1 ORDER BY 1 DESC NULLS LAST`),
    client.$queryRaw<Array<{ code: string | null; count: number; renewed: number }>>(Prisma.sql`
      SELECT NULLIF(r.data->>'bpls_status_code', '') AS code, COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE ${YEAR} = ${year})::int AS renewed
      ${base()} GROUP BY 1 ORDER BY 1 NULLS LAST`),
    client.$queryRaw<Array<{ name: string | null; count: number }>>(Prisma.sql`
      SELECT NULLIF(r.data->>'business_barangay', '') AS name, COUNT(*)::int AS count
      ${base()} AND ${YEAR} = ${year - 1} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`),
    client.$queryRaw<Array<{ name: string | null; count: number }>>(Prisma.sql`
      SELECT NULLIF(r.data->>'line_of_business', '') AS name, COUNT(*)::int AS count
      ${base()} AND ${YEAR} = ${year - 1} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`),
  ]);
  const count = (pred: (y: number | null) => boolean) => byYear.filter((r) => pred(r.year)).reduce((a, r) => a + r.count, 0);
  return {
    year,
    total: count(() => true),
    renewed: count((y) => y !== null && y >= year),
    notRenewed: count((y) => y === year - 1),
    lapsedLonger: count((y) => y !== null && y < year - 1),
    noYear: count((y) => y === null),
    byYear,
    byStatusCode: byCode,
    notRenewedByBarangay: brgy,
    notRenewedByLine: lines,
  };
}

export async function listRenewals(
  client: PrismaClient,
  f: RenewalFilters,
  page: { limit: number; offset: number } | null,
): Promise<{ total: number; items: RenewalBusiness[] }> {
  const paging = page ? Prisma.sql`LIMIT ${page.limit} OFFSET ${page.offset}` : Prisma.empty;
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT r.record_key, r.data->>'business_name' AS business_name, r.data->>'trade_name' AS trade_name,
      r.data->>'tan_taxpayer_account_no' AS tan, r.data->>'line_of_business' AS line,
      r.data->>'business_barangay' AS barangay, ${YEAR} AS last_year, r.data->>'valid_until' AS valid_until,
      r.data->>'business_permit_no' AS permit_no, r.data->>'bpls_status_code' AS status_code,
      COUNT(*) OVER ()::int AS total
    ${base()} ${filterSql(f)}
    ORDER BY ${YEAR} DESC NULLS LAST, r.data->>'business_barangay' NULLS LAST, r.data->>'business_name'
    ${paging}`);
  return {
    total: (rows[0]?.total as number | undefined) ?? 0,
    items: rows.map((r) => ({
      recordId: r.record_key as string,
      businessName: (r.business_name as string | null) || null,
      tradeName: (r.trade_name as string | null) || null,
      tan: (r.tan as string | null) || null,
      line: (r.line as string | null) || null,
      barangay: (r.barangay as string | null) || null,
      lastYear: r.last_year as number | null,
      validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : null,
      permitNo: (r.permit_no as string | null) || null,
      statusCode: (r.status_code as string | null) || null,
    })),
  };
}
