import { Prisma, type PrismaClient } from '@prisma/client';

// Registry status of one row on an office's records page:
//   linked   -- attached to a Citizen that already existed before this record
//   new      -- this record's intake created the Citizen (resolvePerson's
//               "no match" branch, or a queue item rejected as not-a-duplicate)
//   unlinked -- no Citizen at all (a module with requiresCitizenLink off, e.g.
//               an out-of-town birth)
//   review   -- still sitting in the duplicate review queue; not an
//               office_record yet, listed alongside them so staff can see it
// Nothing stores "new vs linked" -- it's derived from timestamps: the intake
// that creates a Citizen writes both rows in the same transaction, so their
// created_at values are within milliseconds. A Citizen created more than
// NEW_CITIZEN_WINDOW before the record already existed.
export type RecordStatus = 'linked' | 'new' | 'unlinked' | 'review';
export const RECORD_STATUSES: RecordStatus[] = ['linked', 'new', 'unlinked', 'review'];
const NEW_CITIZEN_WINDOW_MS = 5000;

export const RECORDS_PAGE_SIZE = 20;

const RECORD_SELECT = {
  id: true,
  personKey: true,
  data: true,
  unresolvedPerson: true,
  createdAt: true,
  citizen: {
    select: {
      personLname: true,
      personFname: true,
      personMname: true,
      personBdate: true,
      createdAt: true,
      barangay: { select: { name: true } },
    },
  },
} as const;

type RecordRow = Prisma.OfficeRecordGetPayload<{ select: typeof RECORD_SELECT }>;

export type RecordListItem = {
  id: string;
  status: RecordStatus;
  data: Prisma.JsonValue;
  unresolvedPerson: Prisma.JsonValue | null;
  createdAt: Date;
  citizen: { personLname: string; personFname: string; personMname: string | null; personBdate: Date | null; barangay: { name: string } | null } | null;
};

export type RecordList = {
  items: RecordListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<RecordStatus | 'all' | 'archived', number>;
  addedThisMonth: number;
};

export function statusOf(r: Pick<RecordRow, 'personKey' | 'createdAt'> & { citizen: { createdAt: Date } | null }): RecordStatus {
  if (!r.personKey || !r.citizen) return 'unlinked';
  return r.citizen.createdAt.getTime() >= r.createdAt.getTime() - NEW_CITIZEN_WINDOW_MS ? 'new' : 'linked';
}

function toItem(r: RecordRow): RecordListItem {
  const { citizen } = r;
  return {
    id: r.id,
    status: statusOf(r),
    data: r.data,
    unresolvedPerson: r.unresolvedPerson,
    createdAt: r.createdAt,
    citizen: citizen
      ? { personLname: citizen.personLname, personFname: citizen.personFname, personMname: citizen.personMname, personBdate: citizen.personBdate, barangay: citizen.barangay }
      : null,
  };
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function parseStatus(raw: unknown): RecordStatus | undefined {
  return typeof raw === 'string' && (RECORD_STATUSES as string[]).includes(raw) ? (raw as RecordStatus) : undefined;
}

export async function listModuleRecords(
  client: PrismaClient,
  moduleId: string,
  // archived: list the module's archived records instead (for Restore).
  opts: { q?: string; status?: RecordStatus; page: number; archived?: boolean },
): Promise<RecordList> {
  const archived = opts.archived ?? false;
  const pat = opts.q ? likePattern(opts.q) : null;
  const windowSql = Prisma.raw(`interval '${NEW_CITIZEN_WINDOW_MS / 1000} seconds'`);

  // One ordered, filterable list across office_record and the module's own
  // pending queue items, so paging and the status chips agree on counts.
  const rowsCte = Prisma.sql`
    WITH rows AS (
      SELECT r.record_key AS id, 'record' AS source, r.created_at,
        CASE WHEN r.person_key IS NULL OR c.person_key IS NULL THEN 'unlinked'
             WHEN c.created_at >= r.created_at - ${windowSql} THEN 'new'
             ELSE 'linked' END AS status
      FROM office_record r
      LEFT JOIN "Citizen" c ON c.person_key = r.person_key
      WHERE r.module_id = ${moduleId}::uuid AND r.is_archived = ${archived}
        ${pat ? Prisma.sql`AND (c.person_lname ILIKE ${pat} OR c.person_fname ILIKE ${pat}
          OR r.unresolved_person->>'lname' ILIKE ${pat} OR r.unresolved_person->>'fname' ILIKE ${pat}
          OR r.data::text ILIKE ${pat})` : Prisma.empty}
      UNION ALL
      SELECT q.id, 'review' AS source, q.created_at, 'review' AS status
      FROM duplicate_review_queue_item q
      WHERE NOT ${archived} AND q.module_id = ${moduleId}::uuid AND q.status = 'pending'
        ${pat ? Prisma.sql`AND (q.candidate_data->>'lname' ILIKE ${pat} OR q.candidate_data->>'fname' ILIKE ${pat})` : Prisma.empty}
    )`;

  const [countRows, pageRows, monthRows, archivedRows] = await Promise.all([
    client.$queryRaw<Array<{ status: RecordStatus; n: number }>>`${rowsCte} SELECT status, count(*)::int AS n FROM rows GROUP BY status`,
    client.$queryRaw<Array<{ id: string; source: 'record' | 'review' }>>`
      ${rowsCte}
      SELECT id, source FROM rows
      ${opts.status ? Prisma.sql`WHERE status = ${opts.status}` : Prisma.empty}
      ORDER BY created_at DESC, id
      LIMIT ${RECORDS_PAGE_SIZE} OFFSET ${(opts.page - 1) * RECORDS_PAGE_SIZE}`,
    client.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM office_record
      WHERE module_id = ${moduleId}::uuid AND is_archived = false AND created_at >= date_trunc('month', now())`,
    client.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM office_record WHERE module_id = ${moduleId}::uuid AND is_archived = true`,
  ]);

  const counts: RecordList['counts'] = { all: 0, linked: 0, new: 0, unlinked: 0, review: 0, archived: archivedRows[0]?.n ?? 0 };
  for (const row of countRows) {
    if (archived) continue;
    counts[row.status] = row.n;
    counts.all += row.n;
  }

  const recordIds = pageRows.filter((r) => r.source === 'record').map((r) => r.id);
  const reviewIds = pageRows.filter((r) => r.source === 'review').map((r) => r.id);
  const [records, reviews] = await Promise.all([
    recordIds.length ? client.officeRecord.findMany({ where: { id: { in: recordIds } }, select: RECORD_SELECT }) : [],
    reviewIds.length
      ? client.duplicateReviewQueueItem.findMany({ where: { id: { in: reviewIds } }, select: { id: true, candidateData: true, createdAt: true } })
      : [],
  ]);

  const byId = new Map<string, RecordListItem>();
  for (const r of records) byId.set(r.id, toItem(r));
  for (const q of reviews) {
    const c = (q.candidateData ?? {}) as { lname?: string; fname?: string; mname?: string; bdate?: string; fields?: Prisma.JsonValue };
    byId.set(q.id, {
      id: q.id,
      status: 'review',
      data: c.fields ?? {},
      unresolvedPerson: { lname: c.lname ?? '', fname: c.fname ?? '', mname: c.mname, bdate: c.bdate ?? '' },
      createdAt: q.createdAt,
      citizen: null,
    });
  }

  return {
    items: pageRows.map((r) => byId.get(r.id)).filter((i): i is RecordListItem => i !== undefined),
    total: archived ? counts.archived : opts.status ? counts[opts.status] : counts.all,
    page: opts.page,
    pageSize: RECORDS_PAGE_SIZE,
    counts,
    addedThisMonth: monthRows[0]?.n ?? 0,
  };
}

// Search (?q=) also matches the record's own field values -- the only
// names a person-less module like Assessor's EGAPS owner list has.

// Every non-archived record in a module, oldest first, for CSV export.
// Queue items are left out -- they aren't records until a reviewer decides.
export async function allModuleRecords(client: PrismaClient, moduleId: string): Promise<RecordListItem[]> {
  const rows = await client.officeRecord.findMany({
    where: { moduleId, isArchived: false },
    select: RECORD_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toItem);
}
