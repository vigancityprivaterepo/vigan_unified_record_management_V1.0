import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getFuzzyMatchThreshold, getBdateToleranceDays } from './config';

export type ResolveCandidate = {
  lname: string;
  fname: string;
  mname?: string | null;
  bdate: Date;
  // Only ever used when creating a brand-new Citizen (below) -- matching an
  // *existing* citizen never overwrites their already-on-file address/sex/
  // civil status with whatever this particular intake happened to collect.
  sex?: string | null;
  civilStatus?: string | null;
  street?: string | null;
  brgyCode?: string | null;
};

export type FuzzyCandidate = {
  personKey: string;
  personLname: string;
  personFname: string;
  personBdate: Date | null;
  similarity: number;
};

export type ResolveResult =
  | { status: 'matched'; personKey: string }
  | { status: 'needs_review'; candidates: FuzzyCandidate[] }
  | { status: 'created'; personKey: string };

export type ResolvePersonOptions = {
  actorUserId?: string;
  // Office routes pass their session's RBAC-scoped client (Phase 4+) so
  // resolvePerson() runs under the caller's actual DB privileges, not the
  // migration-owner superuser. Defaults to that superuser client for
  // existing callers/tests that don't care.
  client?: PrismaClient;
};

type QueryableClient = Pick<PrismaClient, '$queryRaw'>;

// Same normalized key used by the DB-level advisory lock: two candidates
// that would collide on the exact-match check must hash to the same lock.
function lockKeyFor(candidate: ResolveCandidate): string {
  return `${candidate.lname.trim().toLowerCase()}|${candidate.fname.trim().toLowerCase()}|${candidate.bdate.toISOString().slice(0, 10)}`;
}

async function findExactMatch(
  client: QueryableClient,
  candidate: ResolveCandidate,
): Promise<{ personKey: string } | null> {
  const rows = await client.$queryRaw<Array<{ person_key: string }>>`
    SELECT person_key FROM "Citizen"
    WHERE is_archived = false
      AND lower(trim(person_lname)) = lower(trim(${candidate.lname}))
      AND lower(trim(person_fname)) = lower(trim(${candidate.fname}))
      AND person_bdate = ${candidate.bdate}::date
    LIMIT 1
  `;
  return rows[0] ? { personKey: rows[0].person_key } : null;
}

async function findFuzzyMatches(client: QueryableClient, candidate: ResolveCandidate): Promise<FuzzyCandidate[]> {
  const threshold = await getFuzzyMatchThreshold();
  const toleranceDays = await getBdateToleranceDays();

  const rows = await client.$queryRaw<
    Array<{
      person_key: string;
      person_lname: string;
      person_fname: string;
      person_bdate: Date | null;
      sim: number;
    }>
  >`
    SELECT person_key, person_lname, person_fname, person_bdate,
           similarity(lower(person_lname) || ' ' || lower(person_fname),
                      lower(${candidate.lname}) || ' ' || lower(${candidate.fname})) AS sim
    FROM "Citizen"
    WHERE is_archived = false
      AND person_bdate IS NOT NULL
      AND abs(person_bdate - ${candidate.bdate}::date) <= ${toleranceDays}
      AND similarity(lower(person_lname) || ' ' || lower(person_fname),
                      lower(${candidate.lname}) || ' ' || lower(${candidate.fname})) >= ${threshold}
    ORDER BY sim DESC
    LIMIT 10
  `;

  return rows.map((r) => ({
    personKey: r.person_key,
    personLname: r.person_lname,
    personFname: r.person_fname,
    personBdate: r.person_bdate,
    similarity: Number(r.sim),
  }));
}

// Every satellite table's create-flow calls this before writing -- no
// per-office copies of the resolution logic.
//
// 1. Exact match (case-insensitive, trimmed) on lname+fname+bdate -> reuse
//    that person_key.
// 2. No exact match -> pg_trgm fuzzy search (name similarity + near bdate).
//    Any hit above threshold -> 'needs_review', never auto-decided.
// 3. No match at all -> create a new Citizen row.
//
// The whole flow runs inside one transaction holding a DB-level advisory
// lock keyed on the candidate's normalized identity -- not just the create
// step. Locking only around step 3 was tried first and had a real race: if
// two concurrent calls for the same new person both read "no exact match"
// before either locked, the loser's *fuzzy* read (unlocked) could run after
// the winner's commit and see its own just-created row as a fuzzy hit
// (similarity 1.0) instead of an exact one, misclassifying a true duplicate
// as 'needs_review'. Locking the entire read-then-maybe-write sequence
// closes that window. Concurrent calls for *different* people never
// contend -- the lock key is per-identity.
export async function resolvePerson(candidate: ResolveCandidate, options?: ResolvePersonOptions): Promise<ResolveResult> {
  const client = options?.client ?? prisma;

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeyFor(candidate)}))`;

    const exact = await findExactMatch(tx, candidate);
    if (exact) {
      return { status: 'matched' as const, personKey: exact.personKey };
    }

    const fuzzy = await findFuzzyMatches(tx, candidate);
    if (fuzzy.length > 0) {
      return { status: 'needs_review' as const, candidates: fuzzy };
    }

    // `select` narrows RETURNING to person_key only -- a plain `.create()`
    // would RETURNING every column, including the three encrypted ones
    // office roles have no SELECT grant on, and fail with permission denied
    // for any non-admin caller.
    const created = await tx.citizen.create({
      data: {
        personLname: candidate.lname.trim(),
        personFname: candidate.fname.trim(),
        personMname: candidate.mname?.trim() || null,
        personBdate: candidate.bdate,
        personSex: candidate.sex?.trim() || null,
        personCivilStatus: candidate.civilStatus?.trim() || null,
        personStreet: candidate.street?.trim() || null,
        personBrgyCode: candidate.brgyCode?.trim() || null,
        createdBy: options?.actorUserId,
        updatedBy: options?.actorUserId,
      },
      select: { personKey: true },
    });
    return { status: 'created' as const, personKey: created.personKey };
  });
}
