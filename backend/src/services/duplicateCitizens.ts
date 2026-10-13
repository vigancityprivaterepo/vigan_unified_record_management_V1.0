import { Prisma, type PrismaClient } from '@prisma/client';
import { getFuzzyMatchThreshold } from './config';

// Citizens already in the registry who look like the same person, for the
// administrator to merge or to mark as different people. resolvePerson()
// stops most duplicates at the door; this finds the ones that got in before
// it could, or that it cannot tell (a middle name typed into the first name,
// a birthdate one digit off).
//
// A pair is listed when both are active, the administrator has not already
// said they are different (citizen_distinct_pair), and either
//   - they were born the same day and their names are the same by name_key(),
//     close (pg_trgm, the FUZZY_MATCH_THRESHOLD setting), or one first name
//     starts with the other under the same last name; or
//   - their names are the same and their birthdates differ by one digit or
//     have the day and month swapped; or
//   - their names are the same and one of them has no birthdate.

export type DuplicateReason = 'same' | 'similar_name' | 'birthdate_typo' | 'no_birthdate';
export type DuplicatePerson = {
  personKey: string; lname: string; fname: string; mname: string | null; bdate: string | null; sex: string | null;
  barangay: string | null; household: string | null; programs: string[]; createdAt: string;
};
export type DuplicatePair = { reason: DuplicateReason; a: DuplicatePerson; b: DuplicatePerson };

const PAGE_SIZE = 20;

export async function duplicatePairs(client: PrismaClient, page: number): Promise<{ items: DuplicatePair[]; total: number; page: number; pageSize: number }> {
  const threshold = await getFuzzyMatchThreshold();
  const names = (alias: string) => Prisma.raw(`lower(${alias}.person_lname) || ' ' || lower(${alias}.person_fname)`);
  const rows = await client.$queryRaw<Array<{ a: string; b: string; reason: DuplicateReason; total: bigint }>>(Prisma.sql`
    WITH pair AS (
      SELECT a.person_key AS a, b.person_key AS b,
        CASE WHEN name_key(a.person_lname) = name_key(b.person_lname) AND name_key(a.person_fname) = name_key(b.person_fname) THEN 'same' ELSE 'similar_name' END AS reason
      FROM "Citizen" a
      JOIN "Citizen" b ON b.person_bdate = a.person_bdate AND a.person_key < b.person_key AND NOT b.is_archived
      WHERE NOT a.is_archived
        AND (similarity(${names('a')}, ${names('b')}) >= ${threshold}
          OR (name_key(a.person_lname) = name_key(b.person_lname)
            AND (name_key(a.person_fname) LIKE name_key(b.person_fname) || '%' OR name_key(b.person_fname) LIKE name_key(a.person_fname) || '%')))
      UNION
      SELECT a.person_key, b.person_key, 'birthdate_typo'
      FROM "Citizen" a
      JOIN "Citizen" b ON name_key(b.person_lname) = name_key(a.person_lname) AND name_key(b.person_fname) = name_key(a.person_fname)
        AND a.person_key < b.person_key AND NOT b.is_archived AND b.person_bdate <> a.person_bdate
      WHERE NOT a.is_archived
        AND (to_char(a.person_bdate, 'YYYYMMDD') = to_char(b.person_bdate, 'YYYYDDMM')
          OR (SELECT count(*) FROM generate_series(1, 8) i
              WHERE substr(to_char(a.person_bdate, 'YYYYMMDD'), i, 1) <> substr(to_char(b.person_bdate, 'YYYYMMDD'), i, 1)) = 1)
      UNION
      SELECT a.person_key, b.person_key, 'no_birthdate'
      FROM "Citizen" a
      JOIN "Citizen" b ON name_key(b.person_lname) = name_key(a.person_lname) AND name_key(b.person_fname) = name_key(a.person_fname)
        AND a.person_key < b.person_key AND NOT b.is_archived
      WHERE NOT a.is_archived AND (a.person_bdate IS NULL OR b.person_bdate IS NULL)
    )
    SELECT p.a::text, p.b::text, p.reason, count(*) OVER () AS total
    FROM pair p JOIN "Citizen" a ON a.person_key = p.a
    WHERE NOT EXISTS (SELECT 1 FROM citizen_distinct_pair d WHERE d.person_a = p.a AND d.person_b = p.b)
    ORDER BY CASE p.reason WHEN 'same' THEN 0 WHEN 'birthdate_typo' THEN 1 WHEN 'no_birthdate' THEN 2 ELSE 3 END, a.person_lname, a.person_fname, p.a, p.b
    LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`);

  const keys = [...new Set(rows.flatMap((r) => [r.a, r.b]))];
  const people = await client.citizen.findMany({
    where: { personKey: { in: keys } },
    select: {
      personKey: true, personLname: true, personFname: true, personMname: true, personBdate: true, personSex: true, personIsHead: true, createdAt: true,
      barangay: { select: { name: true } },
      parent: { select: { personFname: true, personLname: true } },
      _count: { select: { children: true } },
      officeRecords: { where: { isArchived: false }, select: { module: { select: { name: true } } } },
    },
  });
  const byKey = new Map(people.map((c) => [c.personKey, {
    personKey: c.personKey, lname: c.personLname, fname: c.personFname, mname: c.personMname, bdate: c.personBdate?.toISOString().slice(0, 10) ?? null, sex: c.personSex,
    barangay: c.barangay?.name ?? null,
    household: c.personIsHead ? `Head of a household of ${c._count.children + 1}` : c.parent ? `In the household of ${c.parent.personFname} ${c.parent.personLname}` : null,
    programs: [...new Set(c.officeRecords.map((r) => r.module.name))].sort(),
    createdAt: c.createdAt.toISOString(),
  } satisfies DuplicatePerson]));

  return {
    items: rows.flatMap((r) => { const a = byKey.get(r.a); const b = byKey.get(r.b); return a && b ? [{ reason: r.reason, a, b }] : []; }),
    total: Number(rows[0]?.total ?? 0),
    page,
    pageSize: PAGE_SIZE,
  };
}

// The administrator looked at two citizens and said they are different people.
export async function markDistinct(client: PrismaClient, one: string, other: string, actorUserId: string): Promise<void> {
  const [a, b] = one < other ? [one, other] : [other, one];
  await client.$executeRaw`
    INSERT INTO citizen_distinct_pair (person_a, person_b, created_by) VALUES (${a}::uuid, ${b}::uuid, ${actorUserId}::uuid)
    ON CONFLICT DO NOTHING`;
}
