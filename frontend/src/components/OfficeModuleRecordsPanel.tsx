import { useCallback, useEffect, useRef, useState } from 'react';
import { EditRecordForm } from '@/components/EditRecordForm';
import { Modal } from '@/components/Modal';
import { initials } from '@/lib/officeTheme';
import { IconButton } from '@/components/IconButton';
import { RecordStatusPill, recordPersonName } from '@/components/RecordStatusPill';
import { RecordsListTable, type RecordColumn } from '@/components/RecordsListTable';
import { ARCHIVE_ICON, CHECK_CIRCLE_ICON, EDIT_ICON } from '@/lib/actionIcons';
import {
  api,
  ApiError,
  type OfficeFormField,
  type OfficeModule,
  type OfficeRecordList,
  type OfficeRecordListItem,
  type RecordStatus,
} from '@/lib/api';

type Filter = RecordStatus | 'all' | 'archived';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'linked', label: 'Linked' },
  { key: 'new', label: 'New citizen' },
  { key: 'review', label: 'Awaiting review' },
  { key: 'unlinked', label: 'Not linked' },
  { key: 'archived', label: 'Archived' },
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '--';
  return String(value);
}

function nameFor(r: OfficeRecordListItem): string {
  if (r.citizen) {
    return `${r.citizen.personLname}, ${r.citizen.personFname}${r.citizen.personMname ? ` ${r.citizen.personMname}` : ''}`;
  }
  if (r.unresolvedPerson) {
    return `${r.unresolvedPerson.lname}, ${r.unresolvedPerson.fname}${r.unresolvedPerson.mname ? ` ${r.unresolvedPerson.mname}` : ''} (unlinked)`;
  }
  return '--';
}

function bdateFor(r: OfficeRecordListItem): string {
  return (r.citizen?.personBdate ?? r.unresolvedPerson?.bdate)?.slice(0, 10) ?? '--';
}

function addedOn(r: OfficeRecordListItem): string {
  return new Date(r.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The list-of-saved-records view for one office module -- shared by the
// office_staff-facing "Saved Records" page (DynamicOfficeRecordsPage) and
// admin's "View records" modal on the Offices page (AllOfficesPage), since
// both need the same columns/search/archive behavior, just embedded
// differently. Archiving is a soft-delete (see the backend route's
// comment) with a required reason that goes to the audit log, available
// here regardless of which caller renders it -- the backend's
// requireOfficeAccess already restricts office_staff to their own office
// and lets admin through to any of them.
export function OfficeModuleRecordsPanel({
  officeId,
  officeModule,
  readOnly = false,
  initialQuery,
  onLoaded,
}: {
  officeId: string;
  officeModule: OfficeModule;
  // Admin's read-only office workspace: no Archive action.
  readOnly?: boolean;
  initialQuery?: string;
  onLoaded?: (result: OfficeRecordList) => void;
}) {
  const [fields, setFields] = useState<OfficeFormField[] | null>(null);
  const [status, setStatus] = useState<Filter>('all');
  const [editing, setEditing] = useState<OfficeRecordListItem | null>(null);
  const reloadRef = useRef<() => void>(() => undefined);
  const [counts, setCounts] = useState<OfficeRecordList['counts'] | null>(null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  useEffect(() => {
    setFields(null);
    setFieldsError(null);
    api
      .getOfficeModuleFields(officeId, officeModule.id)
      .then(setFields)
      .catch((err) => setFieldsError(err instanceof ApiError ? err.message : 'Could not load this program’s fields'));
  }, [officeId, officeModule.id]);

  const fetchRecords = useCallback(
    (q: string | undefined, page: number) =>
      status === 'archived'
        ? api.myOfficeModuleRecords(officeId, officeModule.id, q, page, undefined, true)
        : api.myOfficeModuleRecords(officeId, officeModule.id, q, page, status === 'all' ? undefined : status),
    [officeId, officeModule.id, status],
  );

  const handleLoaded = useCallback(
    (result: OfficeRecordList) => {
      // The archived list only knows its own total -- keep the live counts
      // (chips + page header) from the last normal load.
      if (status === 'archived') {
        setCounts((prev) => (prev ? { ...prev, archived: result.counts.archived } : result.counts));
        return;
      }
      setCounts(result.counts);
      onLoaded?.(result);
    },
    [onLoaded, status],
  );

  async function handleArchive(record: OfficeRecordListItem, reload: () => void) {
    const reason = window.prompt(`Why is "${nameFor(record)}" being removed? This goes into the audit trail.`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      window.alert('Please enter a reason of at least 3 characters.');
      return;
    }
    try {
      await api.archiveOfficeRecord(officeId, officeModule.id, record.id, reason.trim());
      reload();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Failed to archive record');
    }
  }

  async function handleRestore(record: OfficeRecordListItem, reload: () => void) {
    const reason = window.prompt(`Why is "${nameFor(record)}" being restored? This goes into the audit trail.`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      window.alert('Please enter a reason of at least 3 characters.');
      return;
    }
    try {
      await api.restoreOfficeRecord(officeId, officeModule.id, record.id, reason.trim());
      reload();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Failed to restore record');
    }
  }

  // A collectPersonInfo=false module's records have no citizen/unresolved
  // person at all -- the Name/Birthdate/Barangay columns would just be a
  // wall of "--", so they're skipped entirely rather than shown empty.
  const columns: RecordColumn<OfficeRecordListItem>[] = [
    ...(officeModule.collectPersonInfo
      ? [
          {
            header: 'Name',
            render: (r) => (
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="ws-avatar">{initials(recordPersonName(r))}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="cell-name" style={{ display: 'block' }}>{recordPersonName(r)}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--t-muted)' }}>
                    {r.status === 'review' ? 'Pending review' : `Born ${bdateFor(r)}`}
                  </span>
                </span>
              </span>
            ),
          } satisfies RecordColumn<OfficeRecordListItem>,
          ...(officeModule.collectBarangay
            ? [{ header: 'Barangay', render: (r) => r.citizen?.barangay?.name ?? '--' } satisfies RecordColumn<OfficeRecordListItem>]
            : []),
        ]
      : []),
    ...(fields ?? []).map((field): RecordColumn<OfficeRecordListItem> =>
      field.fieldType === 'FILE'
        ? {
            // Uploaded document: a View link (opens in a new tab; access is audit-logged).
            header: field.label,
            render: (r) =>
              typeof r.data[field.key] === 'string' && r.status !== 'review' ? (
                <button
                  type="button"
                  className="ws-link"
                  onClick={() =>
                    api.openRecordFile(officeId, officeModule.id, r.id, field.key).catch((err) =>
                      window.alert(err instanceof ApiError ? err.message : 'Could not open the document'),
                    )
                  }
                >
                  View
                </button>
              ) : (
                '--'
              ),
          }
        : { header: field.label, render: (r) => formatValue(r.data[field.key]) },
    ),
    {
      header: 'Added',
      render: (r) => (
        <span className="cell-date">
          {addedOn(r)}
          {r.data._sample === true && <span className="ws-sample-tag">Sample</span>}
        </span>
      ),
    },
    ...(officeModule.collectPersonInfo
      ? [{ header: 'Registry status', render: (r) => <RecordStatusPill record={r} /> } satisfies RecordColumn<OfficeRecordListItem>]
      : []),
  ];

  // "Not linked" only matters for modules that allow unlinked records.
  const filters = FILTERS.filter((f) => (f.key !== 'unlinked' && f.key !== 'archived') || status === f.key || (counts?.[f.key] ?? 0) > 0);
  const toolbar = officeModule.collectPersonInfo ? (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {filters.map((f) => (
        <button key={f.key} type="button" className={`ws-chip${status === f.key ? ' is-on' : ''}`} onClick={() => setStatus(f.key)}>
          {f.label}
          {counts && <span className="mono" style={{ fontSize: 12, opacity: 0.75 }}>{counts[f.key].toLocaleString()}</span>}
        </button>
      ))}
    </div>
  ) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {fieldsError && (
        <div className="alert danger">
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
          </div>
          <div className="body">{fieldsError}</div>
        </div>
      )}

      {fields === null && !fieldsError && <span className="spinner" />}

      {fields !== null && (
        <RecordsListTable<OfficeRecordListItem, OfficeRecordList>
          fetcher={fetchRecords}
          initialQuery={initialQuery}
          toolbar={toolbar}
          onLoaded={handleLoaded}
          getKey={(r) => r.id}
          searchPlaceholder={officeModule.collectPersonInfo ? 'Search last or first name...' : 'Search...'}
          emptyLabel={status === 'all' ? 'No records yet.' : status === 'archived' ? 'Nothing archived.' : 'No records with this status.'}
          columns={columns}
          renderActions={
            readOnly
              ? undefined
              : (r, reload) => {
                  if (status === 'archived') {
                    return <IconButton label="Restore" icon={CHECK_CIRCLE_ICON} onClick={() => handleRestore(r, reload)} />;
                  }
                  if (r.status === 'review') return null;
                  return (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <IconButton
                        label="Edit"
                        icon={EDIT_ICON}
                        onClick={() => {
                          reloadRef.current = reload;
                          setEditing(r);
                        }}
                      />
                      <IconButton label="Archive" icon={ARCHIVE_ICON} danger onClick={() => handleArchive(r, reload)} />
                    </span>
                  );
                }
          }
        />
      )}
      {editing && fields && (
        <Modal title="Correct record" eyebrow={`${officeModule.name} · ${nameFor(editing)}`} onClose={() => setEditing(null)}>
          <EditRecordForm
            officeId={officeId}
            officeModule={officeModule}
            fields={fields}
            record={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reloadRef.current();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
