import { Prisma } from '@prisma/client';

// Relief distribution (CDRRMO): one claim per household per event. A record
// in the module with slug 'relief_distribution' is refused when anyone in
// the same household already has a (non-archived) record for the same event.
//
// - Household = the head's person_key, same as services/disasterLists.ts.
// - Event names match loosely: uppercase, anything that isn't a letter or
//   digit counts as one space ("Typhoon Kristine" = "TYPHOON  KRISTINE.").
// - The check and the insert run in one transaction holding an advisory
//   lock per household + event, so two staff entering the same family at
//   the same moment can't both get through.

export const RELIEF_SLUG = 'relief_distribution';

export function normalizeEvent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const n = value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  return n || null;
}

export type ReliefConflict = { name: string; date: string | null; site: string | null; event: string };

export class ReliefAlreadyClaimedError extends Error {
  constructor(public readonly conflict: ReliefConflict) {
    super(reliefConflictMessage(conflict));
  }
}

export function reliefConflictMessage(c: ReliefConflict): string {
  const when = [c.date ? `on ${c.date}` : null, c.site ? `at ${c.site}` : null].filter(Boolean).join(' ');
  return `This household already received relief for ${c.event}: ${c.name}${when ? ` ${when}` : ''}. One claim per household per event.`;
}

// Call inside a transaction, before creating the record. Throws
// ReliefAlreadyClaimedError on a conflict; does nothing for other modules.
export async function assertNoReliefClaim(
  tx: Prisma.TransactionClient,
  module: { id: string; slug: string },
  personKey: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (module.slug !== RELIEF_SLUG) return;
  const event = normalizeEvent(data.event);
  if (!event) return; // the form requires it; nothing to compare against without one

  const me = await tx.$queryRaw<Array<{ hh: string }>>(Prisma.sql`
    SELECT CASE WHEN person_is_head THEN person_key ELSE COALESCE(person_parent_key, person_key) END AS hh
    FROM "Citizen" WHERE person_key = ${personKey}::uuid`);
  const hh = me[0]?.hh ?? personKey;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`relief:${module.id}:${hh}:${event}`}))`;

  const rows = await tx.$queryRaw<Array<{ lname: string; fname: string; event: string | null; date: string | null; site: string | null }>>(Prisma.sql`
    SELECT c.person_lname AS lname, c.person_fname AS fname, r.data->>'event' AS event,
      r.data->>'distribution_date' AS date, r.data->>'distribution_site' AS site
    FROM office_record r JOIN "Citizen" c ON c.person_key = r.person_key
    WHERE r.module_id = ${module.id}::uuid AND NOT r.is_archived
      AND (CASE WHEN c.person_is_head THEN c.person_key ELSE COALESCE(c.person_parent_key, c.person_key) END) = ${hh}::uuid
      AND trim(regexp_replace(upper(COALESCE(r.data->>'event', '')), '[^A-Z0-9]+', ' ', 'g')) = ${event}
    ORDER BY r.created_at
    LIMIT 1`);
  const hit = rows[0];
  if (hit) {
    throw new ReliefAlreadyClaimedError({
      name: `${hit.lname}, ${hit.fname}`,
      date: hit.date ? hit.date.slice(0, 10) : null,
      site: hit.site,
      event: hit.event ?? event,
    });
  }
}
