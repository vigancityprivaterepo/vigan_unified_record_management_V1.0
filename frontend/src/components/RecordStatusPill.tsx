import type { OfficeRecordListItem, RecordStatus } from '@/lib/api';

export const RECORD_STATUS_LABEL: Record<RecordStatus, string> = {
  linked: 'Linked to registry',
  new: 'New citizen added',
  review: 'Awaiting admin review',
  unlinked: 'Not linked',
};

const PILL_CLASS: Record<RecordStatus, string> = {
  linked: 'ws-pill--linked',
  new: 'ws-pill--new',
  review: 'ws-pill--review',
  unlinked: 'ws-pill--muted',
};

export function RecordStatusPill({ record }: { record: Pick<OfficeRecordListItem, 'status'> }) {
  return <span className={`ws-pill ${PILL_CLASS[record.status]}`}>{RECORD_STATUS_LABEL[record.status]}</span>;
}

export function recordPersonName(r: OfficeRecordListItem): string {
  if (r.citizen) return [r.citizen.personFname, r.citizen.personMname, r.citizen.personLname].filter(Boolean).join(' ');
  if (r.unresolvedPerson) return [r.unresolvedPerson.fname, r.unresolvedPerson.mname, r.unresolvedPerson.lname].filter(Boolean).join(' ');
  return 'Record';
}
