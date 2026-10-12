import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizeEvent, RELIEF_SLUG } from './reliefClaims';

// Disaster lists for CDRRMO: residents who may need help to evacuate, by
// barangay and household, worked out live from the shared registry.
//
// Who counts (fixed, documented definitions -- not configurable on purpose,
// so every barangay's printed list means the same thing):
//   senior       age 60 or older (from birthdate)
//   young_child  younger than 5
//   pwd          has a record in the PWD program (slug 'pwd')
//   pregnant     a Prenatal Care record (slug 'prenatal') whose expected
//                delivery date is no more than 30 days ago, or, without one,
//                a visit (or record date) in the last 280 days
//   solo_parent  has a record in the Solo Parent program (slug 'solo_parent')
// A pregnancy on someone male, under 10 or over 55 is still listed (a wrong
// birthdate or sex must not drop a pregnant woman from an evacuation list)
// but flagged pregnancyNeedsCheck so the record gets corrected.
// People with a death record (slug 'death') and archived citizens are left
// out. "Evacuated now" = latest Evacuees record (slug 'evacuees') without
// returned_home = true.
//
// Household = the head's person_key (a head's own key; members point to it
// through person_parent_key; anyone in no household is their own).

export const CATEGORIES = ['senior', 'young_child', 'pwd', 'pregnant', 'solo_parent'] as const;
export type Category = (typeof CATEGORIES)[number];

// event: a relief event (Relief Distribution records, matched the same loose
// way as the double-claim check in services/reliefClaims.ts). With it, each
// person is marked by whether their household has received relief for that
// event, and relief can filter the list to who has / hasn't.
export type DisasterFilters = { barangayCode?: string; category?: Category; event?: string; relief?: 'received' | 'not_received' };

export type VulnerablePerson = {
  personKey: string;
  name: string;
  age: number | null;
  sex: string | null;
  street: string | null;
  barangay: string | null;
  householdKey: string;
  householdHead: string | null;
  needs: Category[];
  pregnancyNeedsCheck: boolean;
  evacuationCenter: string | null;
  // null when no event is chosen.
  reliefReceived: boolean | null;
};

export type BarangaySummary = {
  code: string | null;
  name: string | null;
  people: number;
  households: number;
  evacuatedNow: number;
  // People / households whose household received relief for the chosen
  // event; 0 when no event is chosen.
  reliefPeople: number;
  reliefHouseholds: number;
} & Record<Category, number>;

const EVENT_NORM = (expr: Prisma.Sql) => Prisma.sql`trim(regexp_replace(upper(COALESCE(${expr}, '')), '[^A-Z0-9]+', ' ', 'g'))`;
const HH = (c: string) => Prisma.raw(`CASE WHEN ${c}.person_is_head THEN ${c}.person_key ELSE COALESCE(${c}.person_parent_key, ${c}.person_key) END`);

const date = (expr: Prisma.Sql) => Prisma.sql`(CASE WHEN ${expr} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(${expr} from 1 for 10)::date END)`;

// One CTE shared by the summary and the list, so both always agree.
function flagged(filters: DisasterFilters): Prisma.Sql {
  const brgy = filters.barangayCode ? Prisma.sql`AND c.person_brgy_code = ${filters.barangayCode}` : Prisma.empty;
  const edd = date(Prisma.sql`r.data->>'expected_delivery_date'`);
  const event = filters.event ? normalizeEvent(filters.event) : null;
  const reliefHouseholds = event
    ? Prisma.sql`relief_hh AS (
        SELECT DISTINCT ${HH('rc')} AS hh
        FROM office_record r JOIN office_module m ON m.id = r.module_id JOIN "Citizen" rc ON rc.person_key = r.person_key
        WHERE m.slug = ${RELIEF_SLUG} AND NOT r.is_archived AND ${EVENT_NORM(Prisma.sql`r.data->>'event'`)} = ${event}
      ),`
    : Prisma.sql`relief_hh AS (SELECT NULL::uuid AS hh WHERE false),`;
  const visit = date(Prisma.sql`r.data->>'visit_date'`);
  return Prisma.sql`
    WITH ${reliefHouseholds}
    -- The five programs these lists read, gathered in one pass and folded to
    -- one row per person. Asking "is this person in program X" once per
    -- citizen instead took seconds and grew with the registry.
    flags AS (
      SELECT r.person_key,
        bool_or(m.slug = 'pwd') AS pwd,
        bool_or(m.slug = 'solo_parent') AS solo_parent,
        bool_or(m.slug = 'death') AS dead,
        bool_or(m.slug = 'prenatal' AND (${edd} >= current_date - 30
                 OR (${edd} IS NULL AND COALESCE(${visit}, r.created_at::date) >= current_date - 280))) AS pregnant,
        (array_agg(COALESCE(NULLIF(r.data->>'evacuation_center', ''), 'Evacuation center not recorded')
           ORDER BY ${date(Prisma.sql`r.data->>'date_evacuated'`)} DESC NULLS LAST, r.created_at DESC)
           FILTER (WHERE m.slug = 'evacuees' AND COALESCE(r.data->>'returned_home', 'false') <> 'true'))[1] AS evac_center
      FROM office_record r JOIN office_module m ON m.id = r.module_id
      WHERE NOT r.is_archived AND r.person_key IS NOT NULL AND m.slug IN ('pwd', 'solo_parent', 'prenatal', 'evacuees', 'death')
      GROUP BY r.person_key
    ),
    people AS (
      SELECT c.person_key, c.person_lname, c.person_fname, c.person_mname, c.person_sex, c.person_street,
        c.person_brgy_code, b.name AS barangay,
        CASE WHEN c.person_is_head THEN c.person_key ELSE COALESCE(c.person_parent_key, c.person_key) END AS hh,
        date_part('year', age(c.person_bdate))::int AS age,
        COALESCE(f.pwd, false) AS pwd, COALESCE(f.solo_parent, false) AS solo_parent, COALESCE(f.pregnant, false) AS pregnant,
        f.evac_center
      FROM "Citizen" c
      LEFT JOIN barangay b ON b.code = c.person_brgy_code
      LEFT JOIN flags f ON f.person_key = c.person_key
      WHERE NOT c.is_archived ${brgy}
        AND NOT COALESCE(f.dead, false)
    ),
    flagged AS (
      SELECT p.*, COALESCE(p.age >= 60, false) AS senior, COALESCE(p.age < 5, false) AS young_child,
        CASE WHEN ${event !== null} THEN x.hh IS NOT NULL END AS relief
      FROM people p
      LEFT JOIN relief_hh x ON x.hh = p.hh
    ),
    vulnerable AS (
      SELECT * FROM flagged WHERE senior OR young_child OR pwd OR pregnant OR solo_parent
    )`;
}

export async function summarize(client: PrismaClient, filters: DisasterFilters): Promise<{ totals: BarangaySummary; barangays: BarangaySummary[] }> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    ${flagged(filters)}
    SELECT person_brgy_code AS code, barangay AS name,
      COUNT(*)::int AS people, COUNT(DISTINCT hh)::int AS households,
      COUNT(*) FILTER (WHERE evac_center IS NOT NULL)::int AS evacuated_now,
      COUNT(*) FILTER (WHERE senior)::int AS senior, COUNT(*) FILTER (WHERE young_child)::int AS young_child,
      COUNT(*) FILTER (WHERE pwd)::int AS pwd, COUNT(*) FILTER (WHERE pregnant)::int AS pregnant,
      COUNT(*) FILTER (WHERE solo_parent)::int AS solo_parent,
      COUNT(*) FILTER (WHERE relief)::int AS relief_people, COUNT(DISTINCT hh) FILTER (WHERE relief)::int AS relief_households
    FROM vulnerable
    GROUP BY person_brgy_code, barangay
    ORDER BY COUNT(*) DESC, barangay
  `);
  const barangays = rows.map((r) => ({
    code: r.code as string | null, name: r.name as string | null,
    people: r.people as number, households: r.households as number, evacuatedNow: r.evacuated_now as number,
    reliefPeople: r.relief_people as number, reliefHouseholds: r.relief_households as number,
    senior: r.senior as number, young_child: r.young_child as number, pwd: r.pwd as number, pregnant: r.pregnant as number, solo_parent: r.solo_parent as number,
  }));
  const sum = (k: keyof BarangaySummary) => barangays.reduce((a, b) => a + (b[k] as number), 0);
  return {
    totals: {
      code: null, name: null, people: sum('people'), households: sum('households'), evacuatedNow: sum('evacuatedNow'),
      reliefPeople: sum('reliefPeople'), reliefHouseholds: sum('reliefHouseholds'),
      senior: sum('senior'), young_child: sum('young_child'), pwd: sum('pwd'), pregnant: sum('pregnant'), solo_parent: sum('solo_parent'),
    },
    barangays,
  };
}

export async function listVulnerable(
  client: PrismaClient,
  filters: DisasterFilters,
  page: { limit: number; offset: number } | null,
): Promise<{ total: number; items: VulnerablePerson[] }> {
  const conds: Prisma.Sql[] = [];
  if (filters.category) conds.push(Prisma.raw(`v.${filters.category}`));
  if (filters.event && filters.relief === 'received') conds.push(Prisma.sql`v.relief`);
  if (filters.event && filters.relief === 'not_received') conds.push(Prisma.sql`NOT v.relief`);
  const cat = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
  const paging = page ? Prisma.sql`LIMIT ${page.limit} OFFSET ${page.offset}` : Prisma.empty;
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    ${flagged(filters)}
    SELECT v.*, h.person_lname AS head_lname, h.person_fname AS head_fname, COUNT(*) OVER ()::int AS total
    FROM vulnerable v
    LEFT JOIN "Citizen" h ON h.person_key = v.hh
    ${cat}
    ORDER BY v.barangay NULLS LAST, h.person_lname, h.person_fname, v.hh, v.age DESC NULLS LAST
    ${paging}
  `);
  return {
    total: (rows[0]?.total as number | undefined) ?? 0,
    items: rows.map((r) => ({
      personKey: r.person_key as string,
      name: [`${r.person_lname},`, r.person_fname, r.person_mname].filter(Boolean).join(' '),
      age: r.age as number | null,
      sex: r.person_sex as string | null,
      street: r.person_street as string | null,
      barangay: r.barangay as string | null,
      householdKey: r.hh as string,
      householdHead: r.head_lname ? `${r.head_lname}, ${r.head_fname}` : null,
      needs: CATEGORIES.filter((c) => r[c] === true),
      pregnancyNeedsCheck: r.pregnant === true && (r.person_sex === 'M' || (r.age != null && ((r.age as number) < 10 || (r.age as number) > 55))),
      evacuationCenter: r.evac_center as string | null,
      reliefReceived: (r.relief as boolean | null) ?? null,
    })),
  };
}

// Sample records in any program these lists read, so the page can say so.
export async function usesSampleData(client: PrismaClient): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ yes: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM office_record r JOIN office_module m ON m.id = r.module_id
      WHERE m.slug IN ('pwd', 'solo_parent', 'prenatal', 'evacuees', 'death') AND r.data->>'_sample' = 'true'
    ) AS yes
  `);
  return rows[0]?.yes ?? false;
}

// Relief events on record (Relief Distribution), newest first, for the
// event picker. Spellings that normalize the same are one event; the most
// used spelling is shown.
export async function reliefEvents(client: PrismaClient): Promise<Array<{ event: string; label: string; households: number; lastDate: string | null }>> {
  const rows = await client.$queryRaw<Array<{ event: string; label: string; households: number; last_date: string | null }>>(Prisma.sql`
    SELECT ${EVENT_NORM(Prisma.sql`r.data->>'event'`)} AS event,
      mode() WITHIN GROUP (ORDER BY r.data->>'event') AS label,
      COUNT(DISTINCT ${HH('c')})::int AS households,
      max(r.data->>'distribution_date') AS last_date
    FROM office_record r JOIN office_module m ON m.id = r.module_id JOIN "Citizen" c ON c.person_key = r.person_key
    WHERE m.slug = ${RELIEF_SLUG} AND NOT r.is_archived AND ${EVENT_NORM(Prisma.sql`r.data->>'event'`)} <> ''
    GROUP BY 1
    ORDER BY max(r.created_at) DESC
    LIMIT 50`);
  return rows.map((r) => ({ event: r.event, label: r.label, households: r.households, lastDate: r.last_date ? r.last_date.slice(0, 10) : null }));
}
