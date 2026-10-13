import { Prisma, type PrismaClient } from '@prisma/client';

// Assistance across offices: who received help, how often, and who has not.
//
// Nothing new is recorded for this. A program is marked "gives assistance"
// in its settings (office_module.gives_assistance), and from then on each of
// its records linked to a citizen counts as one release, dated the day it was
// recorded, valued by the program's amount field if it has one.
//
// Releases are added up per household (the head's person_key, same as
// services/disasterLists.ts). A release to someone who is in no household
// still counts in the totals and per program, as one recipient, but only
// households on record can appear as "not assisted".

export type AssistanceFilters = {
  // Inclusive, 'YYYY-MM-DD'.
  from: string;
  to: string;
  barangayCode?: string;
  // How many releases the household had in the period.
  times?: Times;
};

export const TIMES = ['never', 'once', 'few', 'many'] as const;
export type Times = (typeof TIMES)[number];

export type AssistanceSummary = {
  programs: Array<{ moduleId: string; name: string; office: string; hasAmount: boolean; releases: number; recipients: number; value: number }>;
  releases: number;
  value: number;
  // Releases to people who are in no household on record.
  releasesOutsideHouseholds: number;
  households: { total: number; never: number; once: number; few: number; many: number };
  byBarangay: Array<{ code: string | null; name: string | null; total: number; never: number; assisted: number }>;
};

export type AssistedHousehold = {
  headKey: string;
  head: string;
  barangay: string | null;
  members: number;
  releases: number;
  value: number;
  programs: string | null;
  lastOn: string | null;
};

export type HouseholdRelease = { recordId: string; on: string; program: string; office: string; recipient: string; amount: number | null };

const AMOUNT = Prisma.sql`(CASE WHEN m.assistance_amount_key IS NOT NULL AND r.data->>m.assistance_amount_key ~ '^[0-9]+(\\.[0-9]+)?$' THEN (r.data->>m.assistance_amount_key)::numeric END)`;

// Every release in the period: one row per record of an assistance program.
function releases(f: AssistanceFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT r.record_key, r.module_id, m.name AS program, r.created_at, r.person_key,
      CASE WHEN c.person_is_head THEN c.person_key ELSE c.person_parent_key END AS hh,
      COALESCE(${AMOUNT}, 0) AS amount
    FROM office_record r
    JOIN office_module m ON m.id = r.module_id
    JOIN "Citizen" c ON c.person_key = r.person_key
    WHERE m.gives_assistance AND NOT r.is_archived
      AND r.created_at >= ${f.from}::date AND r.created_at < (${f.to}::date + 1)`;
}

// The household's barangay is its head's; a recipient in no household
// stands in for themselves.
const inBarangay = (f: AssistanceFilters, alias: Prisma.Sql) =>
  f.barangayCode ? Prisma.sql`AND ${alias}.person_brgy_code = ${f.barangayCode}` : Prisma.empty;

const timesSql = (t: Times | undefined): Prisma.Sql =>
  t === 'never' ? Prisma.sql`AND COALESCE(a.n, 0) = 0`
    : t === 'once' ? Prisma.sql`AND a.n = 1`
      : t === 'few' ? Prisma.sql`AND a.n BETWEEN 2 AND 3`
        : t === 'many' ? Prisma.sql`AND a.n >= 4`
          : Prisma.empty;

export async function summarizeAssistance(client: PrismaClient, f: AssistanceFilters): Promise<AssistanceSummary> {
  const [programs, totals, byBarangay] = await Promise.all([
    client.$queryRaw<AssistanceSummary['programs']>(Prisma.sql`
      WITH rel AS (${releases(f)})
      SELECT m.id AS "moduleId", m.name, o.name AS office, m.assistance_amount_key IS NOT NULL AS "hasAmount",
        COUNT(x.record_key)::int AS releases, COUNT(DISTINCT x.unit)::int AS recipients, COALESCE(SUM(x.amount), 0)::float8 AS value
      FROM office_module m
      JOIN office o ON o.id = m.office_id
      LEFT JOIN (
        SELECT rel.*, COALESCE(rel.hh, rel.person_key) AS unit
        FROM rel JOIN "Citizen" u ON u.person_key = COALESCE(rel.hh, rel.person_key)
        WHERE TRUE ${inBarangay(f, Prisma.sql`u`)}
      ) x ON x.module_id = m.id
      WHERE m.gives_assistance
      GROUP BY m.id, m.name, o.name, m.assistance_amount_key
      ORDER BY releases DESC, m.name`),
    client.$queryRaw<Array<{ releases: number; value: number; outside: number }>>(Prisma.sql`
      WITH rel AS (${releases(f)})
      SELECT COUNT(*)::int AS releases, COALESCE(SUM(rel.amount), 0)::float8 AS value,
        COUNT(*) FILTER (WHERE rel.hh IS NULL)::int AS outside
      FROM rel JOIN "Citizen" u ON u.person_key = COALESCE(rel.hh, rel.person_key)
      WHERE TRUE ${inBarangay(f, Prisma.sql`u`)}`),
    client.$queryRaw<Array<{ code: string | null; name: string | null; total: number; never: number; once: number; few: number; many: number }>>(Prisma.sql`
      WITH rel AS (${releases(f)}),
      a AS (SELECT hh, COUNT(*) AS n FROM rel WHERE hh IS NOT NULL GROUP BY hh)
      SELECT h.person_brgy_code AS code, b.name, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE a.n IS NULL)::int AS never,
        COUNT(*) FILTER (WHERE a.n = 1)::int AS once,
        COUNT(*) FILTER (WHERE a.n BETWEEN 2 AND 3)::int AS few,
        COUNT(*) FILTER (WHERE a.n >= 4)::int AS many
      FROM "Citizen" h
      LEFT JOIN a ON a.hh = h.person_key
      LEFT JOIN barangay b ON b.code = h.person_brgy_code
      WHERE h.person_is_head AND NOT h.is_archived ${inBarangay(f, Prisma.sql`h`)}
      GROUP BY h.person_brgy_code, b.name
      ORDER BY b.name NULLS LAST`),
  ]);
  const sum = (k: 'total' | 'never' | 'once' | 'few' | 'many') => byBarangay.reduce((n, r) => n + r[k], 0);
  return {
    programs,
    releases: totals[0]?.releases ?? 0,
    value: totals[0]?.value ?? 0,
    releasesOutsideHouseholds: totals[0]?.outside ?? 0,
    households: { total: sum('total'), never: sum('never'), once: sum('once'), few: sum('few'), many: sum('many') },
    byBarangay: byBarangay.map((r) => ({ code: r.code, name: r.name, total: r.total, never: r.never, assisted: r.total - r.never })),
  };
}

export async function listAssistedHouseholds(
  client: PrismaClient,
  f: AssistanceFilters,
  page: { limit: number; offset: number } | null,
): Promise<{ total: number; items: AssistedHousehold[] }> {
  const paging = page ? Prisma.sql`LIMIT ${page.limit} OFFSET ${page.offset}` : Prisma.empty;
  const rows = await client.$queryRaw<Array<AssistedHousehold & { total: number }>>(Prisma.sql`
    WITH rel AS (${releases(f)}),
    a AS (
      SELECT hh, COUNT(*) AS n, SUM(amount) AS value, MAX(created_at) AS last, string_agg(DISTINCT program, ', ' ORDER BY program) AS programs
      FROM rel WHERE hh IS NOT NULL GROUP BY hh
    )
    SELECT h.person_key AS "headKey", h.person_lname || ', ' || h.person_fname AS head, b.name AS barangay,
      (1 + (SELECT COUNT(*) FROM "Citizen" k WHERE k.person_parent_key = h.person_key AND NOT k.is_archived))::int AS members,
      COALESCE(a.n, 0)::int AS releases, COALESCE(a.value, 0)::float8 AS value, a.programs,
      to_char(a.last, 'YYYY-MM-DD') AS "lastOn", COUNT(*) OVER ()::int AS total
    FROM "Citizen" h
    LEFT JOIN a ON a.hh = h.person_key
    LEFT JOIN barangay b ON b.code = h.person_brgy_code
    WHERE h.person_is_head AND NOT h.is_archived ${inBarangay(f, Prisma.sql`h`)} ${timesSql(f.times)}
    ORDER BY COALESCE(a.n, 0) DESC, COALESCE(a.value, 0) DESC, b.name NULLS LAST, h.person_lname, h.person_fname, h.person_key
    ${paging}`);
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map((r) => ({ headKey: r.headKey, head: r.head, barangay: r.barangay, members: r.members, releases: r.releases, value: r.value, programs: r.programs, lastOn: r.lastOn })),
  };
}

// Everything a household has received, newest first (shown on its page).
export async function householdAssistance(client: PrismaClient, headPersonKey: string, limit = 100): Promise<HouseholdRelease[]> {
  return client.$queryRaw<HouseholdRelease[]>(Prisma.sql`
    SELECT r.record_key AS "recordId", to_char(r.created_at, 'YYYY-MM-DD') AS "on", m.name AS program, o.name AS office,
      c.person_fname || ' ' || c.person_lname AS recipient, ${AMOUNT}::float8 AS amount
    FROM office_record r
    JOIN office_module m ON m.id = r.module_id
    JOIN office o ON o.id = m.office_id
    JOIN "Citizen" c ON c.person_key = r.person_key
    WHERE m.gives_assistance AND NOT r.is_archived
      AND (c.person_key = ${headPersonKey}::uuid OR c.person_parent_key = ${headPersonKey}::uuid)
    ORDER BY r.created_at DESC
    LIMIT ${limit}`);
}
