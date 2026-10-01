import { Prisma, type PrismaClient } from '@prisma/client';

// Privacy tools (RA 10173), read from the append-only audit_log.
//
// A person's access history = audit entries that are about them:
//   - entries on their Citizen row (profile opened, household opened,
//     details changed, merged, added);
//   - entries on their office records (added, changed, removed, document
//     opened);
//   - list views and printed sheets that showed them (changed_fields
//     .personKeys: Program gaps and Disaster list pages, printed barangay
//     sheets, household views).
// Bulk CSV exports record only filters and a row count, not every person in
// them (a city-wide export would mean thousands of keys per entry), so they
// appear in the access report, not in a person's history.

export type AccessEntry = {
  id: string;
  at: string;
  who: string;
  office: string | null;
  role: string | null;
  what: string;
};

type Row = {
  id: string; at: Date; action: string; table_name: string; changed_fields: Record<string, unknown> | null;
  actor_role: string | null; username: string | null; full_name: string | null; deleted_username: string | null; office: string | null; rule_name: string | null;
};

function describe(r: Row): string {
  const f = r.changed_fields ?? {};
  const view = typeof f.view === 'string' ? f.view : '';
  const event = typeof f.event === 'string' ? f.event : '';
  if (r.table_name === 'program_gap_rule') return `Saw this person in Program gaps: ${r.rule_name ?? 'a rule'}`;
  if (view === 'disaster-list:people') return 'Saw this person in a Disaster list';
  if (view === 'disaster-list:print') return 'Printed a Disaster list that includes this person';
  if (r.table_name === 'Citizen') {
    if (event === 'profile_view') return 'Opened the citizen profile';
    if (event === 'household_view') return 'Opened the household';
    if (r.action === 'insert') return 'Added this person to the registry';
    if (r.action === 'update') return 'Changed this person’s details';
    if (r.action === 'merge') return 'Merged a duplicate record into this person';
    if (r.action === 'read') return 'Viewed this person’s data';
  }
  if (r.table_name === 'OfficeRecord' || r.table_name === 'office_record') {
    if (event === 'document_view') return 'Opened an uploaded document';
    if (r.action === 'insert') return 'Added an office record';
    if (r.action === 'update') return 'Changed an office record';
    if (r.action === 'delete') return 'Removed an office record';
    return 'Viewed an office record';
  }
  return `${r.action} on ${r.table_name}`;
}

// A deleted staff account no longer has a row to join; its username survives
// in the audit entry that recorded the deletion (deleted_username below).
const who = (r: { full_name: string | null; username: string | null; deleted_username?: string | null }) =>
  r.full_name ?? r.username ?? (r.deleted_username ? `${r.deleted_username} (deleted account)` : 'Unknown account');
const DELETED_USERNAME = Prisma.sql`(SELECT d.changed_fields->>'username' FROM audit_log d
  WHERE d.table_name = 'staff_account' AND d.action = 'delete' AND d.record_id = a.actor_user_id LIMIT 1)`;

export async function accessHistory(client: PrismaClient, personKey: string, limit = 200): Promise<AccessEntry[]> {
  const rows = await client.$queryRaw<Row[]>(Prisma.sql`
    SELECT a.id, a.timestamp AS at, a.action::text AS action, a.table_name, a.changed_fields, a.actor_role,
      s.username, s.full_name, ${DELETED_USERNAME} AS deleted_username, o.name AS office, g.name AS rule_name
    FROM audit_log a
    LEFT JOIN staff_account s ON s.id = a.actor_user_id
    LEFT JOIN office o ON o.id = s.office_id
    LEFT JOIN program_gap_rule g ON a.table_name = 'program_gap_rule' AND g.id = a.record_id
    WHERE (a.table_name = 'Citizen' AND a.record_id = ${personKey}::uuid)
       OR (a.changed_fields -> 'personKeys') @> jsonb_build_array(${personKey}::text)
       OR (a.table_name IN ('OfficeRecord', 'office_record')
           AND a.record_id IN (SELECT record_key FROM office_record WHERE person_key = ${personKey}::uuid))
    ORDER BY a.timestamp DESC
    LIMIT ${limit}`);
  return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), who: who(r), office: r.office, role: r.actor_role, what: describe(r) }));
}

export type AccessReport = {
  month: string;
  people: Array<{ who: string; office: string | null; role: string | null; views: number; exports: number; rowsExported: number }>;
  exports: Array<{ id: string; at: string; who: string; office: string | null; what: string; rows: number | null }>;
};

// COALESCE: an entry with no event/view field would otherwise be NULL here
// and drop out of both the view and the export counts.
const EXPORT_WHERE = Prisma.sql`COALESCE(a.changed_fields->>'event' = 'export_csv' OR a.changed_fields->>'view' LIKE '%export' OR a.changed_fields->>'view' LIKE '%print', false)`;
const ROWS = Prisma.sql`COALESCE(NULLIF(a.changed_fields->>'rows', '')::int, NULLIF(a.changed_fields->>'rowCount', '')::int)`;

function exportWhat(f: Record<string, unknown> | null, ruleName: string | null): string {
  const view = typeof f?.view === 'string' ? f.view : '';
  if (f?.event === 'export_csv') return f.kind === 'masterlist' ? 'Exported the citizen masterlist' : 'Exported office records';
  if (view === 'export') return `Exported Program gaps: ${ruleName ?? 'a rule'}`;
  if (view === 'disaster-list:export') return 'Exported a Disaster list';
  if (view === 'disaster-list:print') return 'Printed a Disaster list';
  if (view === 'business-renewals:export') return 'Exported Business renewals';
  return 'Exported data';
}

// Reads of personal data in one calendar month (YYYY-MM). Sign-ins and
// staff-account reads are left out: this is about citizens' data.
export async function accessReport(client: PrismaClient, month: string): Promise<AccessReport> {
  const start = Prisma.sql`(${month} || '-01')::date`;
  const inMonth = Prisma.sql`a.action = 'read' AND a.table_name <> 'staff_account' AND a.timestamp >= ${start} AND a.timestamp < ${start} + interval '1 month'`;
  const [people, exports] = await Promise.all([
    client.$queryRaw<Array<{ full_name: string | null; username: string | null; deleted_username: string | null; office: string | null; actor_role: string | null; views: number; exports: number; rows_exported: number }>>(Prisma.sql`
      SELECT s.full_name, s.username, ${DELETED_USERNAME} AS deleted_username, o.name AS office, a.actor_role,
        COUNT(*) FILTER (WHERE NOT ${EXPORT_WHERE})::int AS views,
        COUNT(*) FILTER (WHERE ${EXPORT_WHERE})::int AS exports,
        COALESCE(SUM(${ROWS}) FILTER (WHERE ${EXPORT_WHERE}), 0)::int AS rows_exported
      FROM audit_log a LEFT JOIN staff_account s ON s.id = a.actor_user_id LEFT JOIN office o ON o.id = s.office_id
      WHERE ${inMonth}
      GROUP BY a.actor_user_id, s.id, s.full_name, s.username, o.name, a.actor_role
      ORDER BY 6 DESC, 5 DESC`),
    client.$queryRaw<Array<{ id: string; at: Date; full_name: string | null; username: string | null; deleted_username: string | null; office: string | null; changed_fields: Record<string, unknown> | null; rule_name: string | null; rows: number | null }>>(Prisma.sql`
      SELECT a.id, a.timestamp AS at, s.full_name, s.username, ${DELETED_USERNAME} AS deleted_username, o.name AS office, a.changed_fields, g.name AS rule_name, ${ROWS} AS rows
      FROM audit_log a LEFT JOIN staff_account s ON s.id = a.actor_user_id LEFT JOIN office o ON o.id = s.office_id
      LEFT JOIN program_gap_rule g ON a.table_name = 'program_gap_rule' AND g.id = a.record_id
      WHERE ${inMonth} AND ${EXPORT_WHERE}
      ORDER BY a.timestamp DESC
      LIMIT 500`),
  ]);
  return {
    month,
    people: people.map((p) => ({ who: who(p), office: p.office, role: p.actor_role, views: p.views, exports: p.exports, rowsExported: p.rows_exported })),
    exports: exports.map((e) => ({ id: e.id, at: e.at.toISOString(), who: who(e), office: e.office, what: exportWhat(e.changed_fields, e.rule_name), rows: e.rows })),
  };
}
