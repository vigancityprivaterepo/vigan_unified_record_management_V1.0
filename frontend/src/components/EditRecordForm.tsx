import { useState } from 'react';
import { DynamicExtraFields, toSubmitValues, type FieldValues } from '@/components/DynamicExtraFields';
import { api, ApiError, type OfficeFormField, type OfficeModule, type OfficeRecordListItem } from '@/lib/api';

// Record data as the form-state values DynamicExtraFields expects.
function toFieldValues(fields: OfficeFormField[], data: Record<string, unknown>): FieldValues {
  return Object.fromEntries(
    fields.map((f) => {
      const v = data[f.key];
      if (f.fieldType === 'BOOLEAN') return [f.key, Boolean(v)];
      // Older intake stored dropdown picks uppercased ("WALK-IN"); match the
      // option case-insensitively so the dropdown still shows the value.
      const opt = (x: unknown) => f.options.find((o) => o.toUpperCase() === String(x).toUpperCase()) ?? String(x);
      if (f.fieldType === 'MULTISELECT') return [f.key, Array.isArray(v) ? v.map(opt) : []];
      if (f.fieldType === 'SELECT' && v !== null && v !== undefined && v !== '') return [f.key, opt(v)];
      return [f.key, v === null || v === undefined ? '' : String(v)];
    }),
  );
}

// Correct an input mistake in one record. Changes go to the backend with a
// required reason; the audit log keeps every changed value's before/after.
// Name/birthdate are only editable here for records NOT linked to a citizen
// -- a registered citizen's identity is corrected by admin (Citizens page).
export function EditRecordForm({
  officeId,
  officeModule,
  fields,
  record,
  onSaved,
  onCancel,
}: {
  officeId: string;
  officeModule: OfficeModule;
  fields: OfficeFormField[];
  record: OfficeRecordListItem;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editable = fields.filter((f) => f.fieldType !== 'FILE');
  const [values, setValues] = useState<FieldValues>(() => toFieldValues(editable, record.data));
  const canEditPerson = officeModule.collectPersonInfo && !record.citizen && !!record.unresolvedPerson;
  const [person, setPerson] = useState({
    lname: record.unresolvedPerson?.lname ?? '',
    fname: record.unresolvedPerson?.fname ?? '',
    mname: record.unresolvedPerson?.mname ?? '',
    bdate: record.unresolvedPerson?.bdate?.slice(0, 10) ?? '',
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.editOfficeRecord(officeId, officeModule.id, record.id, {
        reason: reason.trim(),
        fields: toSubmitValues(editable, values),
        ...(canEditPerson
          ? {
              person: {
                lname: person.lname.trim() || undefined,
                fname: person.fname.trim() || undefined,
                mname: person.mname.trim() || undefined,
                bdate: person.bdate || undefined,
              },
            }
          : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the correction');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {record.citizen && officeModule.collectPersonInfo && (
        <div className="alert info">
          <div className="body">
            This record is linked to a registered citizen. To fix their name or birthdate, ask an administrator to
            correct it in Citizens, since it's shared with every office.
          </div>
        </div>
      )}

      {canEditPerson && (
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="edit-lname">Last name</label>
            <input id="edit-lname" className="input" value={person.lname} onChange={(e) => setPerson((p) => ({ ...p, lname: e.target.value }))} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="edit-fname">First name</label>
            <input id="edit-fname" className="input" value={person.fname} onChange={(e) => setPerson((p) => ({ ...p, fname: e.target.value }))} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="edit-mname">Middle name</label>
            <input id="edit-mname" className="input" value={person.mname} onChange={(e) => setPerson((p) => ({ ...p, mname: e.target.value }))} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="edit-bdate">Birthdate</label>
            <input id="edit-bdate" type="date" className="input" value={person.bdate} onChange={(e) => setPerson((p) => ({ ...p, bdate: e.target.value }))} />
          </div>
        </div>
      )}

      <DynamicExtraFields fields={editable} values={values} onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))} />

      <div className="field">
        <label className="field-label" htmlFor="edit-reason">
          Reason for the correction<span className="req">*</span>
        </label>
        <input
          id="edit-reason"
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Wrong OSCA ID typed at intake"
          minLength={3}
          required
        />
        <span className="field-hint">Saved to the audit trail with the old and new values.</span>
      </div>

      {error && <div className="field-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving || reason.trim().length < 3}>
          {saving ? 'Saving...' : 'Save correction'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
