import { Prisma, type PrismaClient } from '@prisma/client';
import { applyDeath } from './deathEffects';
import { insertAuditLog } from '../lib/auditLog';
import { getFuzzyMatchThreshold } from './config';

// Linking existing records to the City Citizen Registry, for programs where
// the link is optional and records were saved with just the person's name
// (office_record.unresolved_person), e.g. BPLO business permits imported
// from BPLS, or births of people not yet in the registry.
//
// Candidates: registry citizens whose name matches the record's exactly
// (case and spacing ignored) or closely (pg_trgm similarity at least the
// FUZZY_MATCH_THRESHOLD setting, same as duplicate detection), best 3.
//
// Safety: a name alone does not identify a person (two JUAN DELA CRUZ), so
//  - "sure" = exact name AND the same birthdate, and exactly one such
//    citizen: only these may be linked in bulk;
//  - every other candidate is linked one record at a time, by staff,
//    after comparing barangay, birthdate and programs.
// Every link is audit-logged with the previous unresolved name.

export type LinkCandidate = {
  personKey: string; name: string; bdate: string | null; barangay: string | null;
  similarity: number; exactName: boolean; sameBirthdate: boolean; programs: string[];
};
export type LinkRow = {
  recordId: string; name: string; bdate: string | null; context: string | null; sure: boolean; candidates: LinkCandidate[];
};

async function pairs(client: PrismaClient, moduleId: string) {
  const threshold = await getFuzzyMatchThreshold();
  return client.$queryRaw<Array<{
    record_key: string; r_lname: string; r_fname: string | null; r_mname: string | null; r_bdate: string | null; context: string | null;
    person_key: string; c_lname: string; c_fname: string; c_mname: string | null; c_bdate: Date | null; barangay: string | null;
    sim: number; exact_name: boolean; same_bdate: boolean; programs: string[] | null;
  }>>(Prisma.sql`
    WITH rec AS (
      SELECT r.record_key,
        r.unresolved_person->>'lname' AS lname, NULLIF(r.unresolved_person->>'fname', '') AS fname,
        NULLIF(r.unresolved_person->>'mname', '') AS mname,
        CASE WHEN r.unresolved_person->>'bdate' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(r.unresolved_person->>'bdate', 10) END AS bdate,
        COALESCE(r.data->>'business_name', r.data->>'trade_name') AS context,
        lower(trim(coalesce(r.unresolved_person->>'lname', ''))) || ' ' || lower(trim(coalesce(r.unresolved_person->>'fname', ''))) AS key
      FROM office_record r
      WHERE r.module_id = ${moduleId}::uuid AND NOT r.is_archived AND r.person_key IS NULL
        AND coalesce(r.unresolved_person->>'fname', '') <> '' AND coalesce(r.unresolved_person->>'lname', '') <> ''
    ),
    hit AS (
      SELECT rec.*, c.person_key, c.person_lname, c.person_fname, c.person_mname, c.person_bdate, c.person_brgy_code,
        similarity(lower(c.person_lname) || ' ' || lower(c.person_fname), rec.key) AS sim,
        (lower(trim(c.person_lname)) = lower(trim(rec.lname)) AND lower(trim(c.person_fname)) = lower(trim(rec.fname))) AS exact_name,
        (rec.bdate IS NOT NULL AND c.person_bdate = rec.bdate::date) AS same_bdate
      FROM rec JOIN "Citizen" c
        ON NOT c.is_archived
       AND (lower(c.person_lname) || ' ' || lower(c.person_fname)) % rec.key
    ),
    ranked AS (
      SELECT h.*, row_number() OVER (PARTITION BY h.record_key ORDER BY h.exact_name DESC, h.same_bdate DESC, h.sim DESC) AS rn
      FROM hit h WHERE h.exact_name OR h.sim >= ${threshold}
    )
    SELECT x.record_key, x.lname AS r_lname, x.fname AS r_fname, x.mname AS r_mname, x.bdate AS r_bdate, x.context,
      x.person_key, x.person_lname AS c_lname, x.person_fname AS c_fname, x.person_mname AS c_mname, x.person_bdate AS c_bdate,
      b.name AS barangay, x.sim::float AS sim, x.exact_name, x.same_bdate,
      (SELECT array_agg(DISTINCT m.name ORDER BY m.name) FROM office_record o JOIN office_module m ON m.id = o.module_id
        WHERE o.person_key = x.person_key AND NOT o.is_archived) AS programs
    FROM ranked x LEFT JOIN barangay b ON b.code = x.person_brgy_code
    WHERE x.rn <= 3
    ORDER BY x.lname, x.fname, x.record_key, x.rn`);
}

export async function linkCandidates(
  client: PrismaClient,
  moduleId: string,
  page: { limit: number; offset: number },
): Promise<{ unlinked: number; withCandidates: number; sure: number; items: LinkRow[] }> {
  const [count] = await client.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS n FROM office_record r
    WHERE r.module_id = ${moduleId}::uuid AND NOT r.is_archived AND r.person_key IS NULL AND r.unresolved_person IS NOT NULL`);
  const byRecord = new Map<string, LinkRow>();
  for (const p of await pairs(client, moduleId)) {
    let row = byRecord.get(p.record_key);
    if (!row) {
      row = { recordId: p.record_key, name: [`${p.r_lname},`, p.r_fname, p.r_mname].filter(Boolean).join(' '), bdate: p.r_bdate, context: p.context, sure: false, candidates: [] };
      byRecord.set(p.record_key, row);
    }
    row.candidates.push({
      personKey: p.person_key, name: [`${p.c_lname},`, p.c_fname, p.c_mname].filter(Boolean).join(' '),
      bdate: p.c_bdate ? p.c_bdate.toISOString().slice(0, 10) : null, barangay: p.barangay,
      similarity: Math.round(p.sim * 100) / 100, exactName: p.exact_name, sameBirthdate: p.same_bdate, programs: p.programs ?? [],
    });
  }
  const rows = [...byRecord.values()];
  for (const r of rows) r.sure = r.candidates.filter((c) => c.exactName && c.sameBirthdate).length === 1;
  rows.sort((a, b) => Number(b.sure) - Number(a.sure) || a.name.localeCompare(b.name));
  return {
    unlinked: count?.n ?? 0,
    withCandidates: rows.length,
    sure: rows.filter((r) => r.sure).length,
    items: rows.slice(page.offset, page.offset + page.limit),
  };
}

type Actor = { userId: string; role: string };

async function linkOne(client: PrismaClient, moduleId: string, recordId: string, personKey: string, actor: Actor, how: 'confirmed' | 'bulk_sure') {
  const rec = await client.officeRecord.findUnique({ where: { id: recordId }, select: { moduleId: true, personKey: true, unresolvedPerson: true, isArchived: true } });
  if (!rec || rec.moduleId !== moduleId || rec.isArchived) return { ok: false as const, status: 404, message: 'No such record' };
  if (rec.personKey) return { ok: false as const, status: 409, message: 'This record is already linked' };
  const citizen = await client.citizen.findUnique({ where: { personKey }, select: { isArchived: true } });
  if (!citizen || citizen.isArchived) return { ok: false as const, status: 404, message: 'No such citizen' };
  // unresolved_person is kept, so the name the office recorded stays on file.
  await client.officeRecord.update({ where: { id: recordId }, data: { personKey, updatedBy: actor.userId }, select: { id: true } });
  await insertAuditLog(client, {
    tableName: 'OfficeRecord', recordId, action: 'update', actorUserId: actor.userId, actorRole: actor.role,
    changedFields: { event: 'registry_link', how, personKey, recordedName: rec.unresolvedPerson ?? null },
  });
  await applyDeath(client, recordId, actor);
  return { ok: true as const };
}

export function linkRecord(client: PrismaClient, moduleId: string, recordId: string, personKey: string, actor: Actor) {
  return linkOne(client, moduleId, recordId, personKey, actor, 'confirmed');
}

// Links every "sure" record (exact name + same birthdate + one citizen).
export async function linkSure(client: PrismaClient, moduleId: string, actor: Actor): Promise<{ linked: number }> {
  const sure = new Map<string, string>();
  const perRecord = new Map<string, Array<{ key: string; sure: boolean }>>();
  for (const p of await pairs(client, moduleId)) {
    perRecord.set(p.record_key, [...(perRecord.get(p.record_key) ?? []), { key: p.person_key, sure: p.exact_name && p.same_bdate }]);
  }
  for (const [rec, cands] of perRecord) {
    const s = cands.filter((c) => c.sure);
    if (s.length === 1) sure.set(rec, s[0]!.key);
  }
  let linked = 0;
  for (const [recordId, personKey] of sure) {
    if ((await linkOne(client, moduleId, recordId, personKey, actor, 'bulk_sure')).ok) linked++;
  }
  return { linked };
}
