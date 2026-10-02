import { Prisma, type PrismaClient } from '@prisma/client';

// Program gaps: each ProgramGapRule asks one question of the shared registry
// (see the schema.prisma comment above ProgramGapRule). Everything is
// computed live from Citizen + office_record; nothing is stored per person.
//
//   missing  = matches the conditions AND has no record in the target
//              program. People with a death record are left out, since they
//              can't be reached.
//   conflict = matches the conditions AND does have a record in the target
//              program (e.g. a death record AND still on a pension list).
//
// "Death record" means any record in a module with slug 'death' (Civil
// Registry), the same slug the starting rules use.

export type GapRule = {
  id: string;
  name: string;
  description: string | null;
  kind: 'missing' | 'conflict';
  targetModuleId: string;
  sourceModuleIds: string[];
  minAge: number | null;
  maxAge: number | null;
  sex: string | null;
  isActive: boolean;
};

export type GapFilters = { barangayCode?: string };

export type GapPerson = {
  personKey: string;
  name: string;
  age: number | null;
  sex: string | null;
  barangay: string | null;
  // Only the rule's own evidence: which of the rule's source programs this
  // person is in. Never the person's other programs.
  sourcePrograms: string[];
};

export function whereFor(rule: GapRule, filters: GapFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`NOT c.is_archived`];
  // Age in whole years on today's date: >= minAge means born on or before
  // today minus minAge years; <= maxAge means born after today minus
  // (maxAge + 1) years. Unknown birthdates never match an age condition.
  if (rule.minAge != null) parts.push(Prisma.sql`c.person_bdate <= (current_date - make_interval(years => ${rule.minAge}::int))`);
  if (rule.maxAge != null) parts.push(Prisma.sql`c.person_bdate > (current_date - make_interval(years => ${rule.maxAge + 1}::int))`);
  if (rule.sex) parts.push(Prisma.sql`upper(c.person_sex) = upper(${rule.sex})`);
  if (filters.barangayCode) parts.push(Prisma.sql`c.person_brgy_code = ${filters.barangayCode}`);
  if (rule.sourceModuleIds.length > 0) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM office_record s
      WHERE s.person_key = c.person_key AND NOT s.is_archived
        AND s.module_id = ANY(${rule.sourceModuleIds}::uuid[]))`);
  }
  const inTarget = Prisma.sql`EXISTS (
    SELECT 1 FROM office_record t
    WHERE t.person_key = c.person_key AND NOT t.is_archived AND t.module_id = ${rule.targetModuleId}::uuid)`;
  if (rule.kind === 'missing') {
    parts.push(Prisma.sql`NOT ${inTarget}`);
    parts.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM office_record d JOIN office_module dm ON dm.id = d.module_id
      WHERE d.person_key = c.person_key AND NOT d.is_archived AND dm.slug = 'death')`);
  } else {
    parts.push(inTarget);
  }
  return Prisma.join(parts, ' AND ');
}

export async function countGap(client: PrismaClient, rule: GapRule, filters: GapFilters): Promise<{ total: number; byBarangay: Array<{ code: string | null; name: string | null; count: number }> }> {
  const rows = await client.$queryRaw<Array<{ code: string | null; name: string | null; count: bigint }>>(Prisma.sql`
    SELECT c.person_brgy_code AS code, b.name, COUNT(*) AS count
    FROM "Citizen" c LEFT JOIN barangay b ON b.code = c.person_brgy_code
    WHERE ${whereFor(rule, filters)}
    GROUP BY c.person_brgy_code, b.name
    ORDER BY COUNT(*) DESC, b.name
  `);
  const byBarangay = rows.map((r) => ({ code: r.code, name: r.name, count: Number(r.count) }));
  return { total: byBarangay.reduce((a, r) => a + r.count, 0), byBarangay };
}

// Whether any record in the rule's programs is sample data, so the page can
// label the result "Sample data" instead of passing it off as real.
export async function usesSampleData(client: PrismaClient, rule: GapRule): Promise<boolean> {
  const ids = [rule.targetModuleId, ...rule.sourceModuleIds];
  const rows = await client.$queryRaw<Array<{ yes: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM office_record WHERE module_id = ANY(${ids}::uuid[]) AND data->>'_sample' = 'true'
    ) AS yes
  `);
  return rows[0]?.yes ?? false;
}

export async function listGapPeople(
  client: PrismaClient,
  rule: GapRule,
  filters: GapFilters,
  page: { limit: number; offset: number } | null,
): Promise<GapPerson[]> {
  const paging = page ? Prisma.sql`LIMIT ${page.limit} OFFSET ${page.offset}` : Prisma.empty;
  const rows = await client.$queryRaw<Array<{
    person_key: string; lname: string; fname: string; mname: string | null; age: number | null; sex: string | null; barangay: string | null; source_programs: string[] | null;
  }>>(Prisma.sql`
    SELECT c.person_key, c.person_lname AS lname, c.person_fname AS fname, c.person_mname AS mname,
      date_part('year', age(c.person_bdate))::int AS age, c.person_sex AS sex, b.name AS barangay,
      (SELECT array_agg(DISTINCT m.name ORDER BY m.name) FROM office_record s JOIN office_module m ON m.id = s.module_id
        WHERE s.person_key = c.person_key AND NOT s.is_archived AND s.module_id = ANY(${rule.sourceModuleIds}::uuid[])) AS source_programs
    FROM "Citizen" c LEFT JOIN barangay b ON b.code = c.person_brgy_code
    WHERE ${whereFor(rule, filters)}
    ORDER BY b.name NULLS LAST, c.person_lname, c.person_fname
    ${paging}
  `);
  return rows.map((r) => ({
    personKey: r.person_key,
    name: [`${r.lname},`, r.fname, r.mname].filter(Boolean).join(' '),
    age: r.age,
    sex: r.sex,
    barangay: r.barangay,
    sourcePrograms: r.source_programs ?? [],
  }));
}

export function toGapRule(row: {
  id: string; name: string; description: string | null; kind: string; targetModuleId: string; sourceModuleIds: string[];
  minAge: number | null; maxAge: number | null; sex: string | null; isActive: boolean;
}): GapRule {
  return { ...row, kind: row.kind === 'conflict' ? 'conflict' : 'missing' };
}
