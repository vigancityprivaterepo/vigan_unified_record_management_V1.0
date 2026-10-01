import type { OfficeRecordListItem } from '@/lib/api';

// Add as a column in OfficeModuleRecordsPanel's RecordsListTable columns:
//   { header: 'Registry status', render: (r) => <RecordStatusPill record={r} /> }
export function RecordStatusPill({ record }: { record: OfficeRecordListItem }) {
  if (record.citizen) return <span className="ws-pill ws-pill--linked">Linked to registry</span>;
  if (record.unresolvedPerson) return <span className="ws-pill ws-pill--review">Not linked</span>;
  return <span className="ws-pill ws-pill--muted">No person</span>;
}

export function recordPersonName(r: OfficeRecordListItem): string {
  if (r.citizen) return [r.citizen.personFname, r.citizen.personMname, r.citizen.personLname].filter(Boolean).join(' ');
  if (r.unresolvedPerson) return [r.unresolvedPerson.fname, r.unresolvedPerson.mname, r.unresolvedPerson.lname].filter(Boolean).join(' ');
  return 'Record';
}
