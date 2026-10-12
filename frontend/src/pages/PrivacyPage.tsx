import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { api, ApiError, type AccessEntry, type AccessReport, type DataRequest, type DataRequestKind } from '@/lib/api';

// Privacy (RA 10173), admin only: the monthly access report and the data
// subject request log. A citizen's own access history and requests are on
// their profile (CitizensPage uses the pieces exported below).
export const KIND_LABEL: Record<DataRequestKind, string> = {
  access: 'See their data',
  correction: 'Correct their data',
  erasure: 'Delete their data',
  objection: 'Object to its use',
  other: 'Other',
};
const STATUS_LABEL: Record<DataRequest['status'], string> = { open: 'Open', done: 'Done', declined: 'Declined' };
const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const daysSince = (day: string) => Math.max(0, Math.floor((Date.now() - new Date(`${day}T00:00:00`).getTime()) / 86400000));

export function PrivacyPage() {
  const [tab, setTab] = useState<'access' | 'requests'>('access');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>Privacy</h1>        </div>
        <div className="ws-seg" role="tablist" aria-label="Privacy view">
          <button type="button" role="tab" aria-selected={tab === 'access'} className={tab === 'access' ? 'is-on' : ''} onClick={() => setTab('access')}>Access report</button>
          <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'is-on' : ''} onClick={() => setTab('requests')}>Data requests</button>
        </div>
      </div>
      {tab === 'access' ? <AccessReportView /> : <DataRequestsView />}
    </div>
  );
}

function AccessReportView() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<AccessReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    setReport(null);
    api.privacyAccess(month).then(setReport).catch(setError);
  }, [month, attempt]);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <label className="field-label" htmlFor="pv-month" style={{ margin: 0 }}>Month</label>
        <input id="pv-month" className="input" type="month" style={{ width: 'auto' }} value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      {error != null && <LoadError what="the access report" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {error == null && !report && <span className="spinner" />}
      {report && (
        <>
          <section className="ws-card ws-card--pad ws-stack-y">
            <h2 style={{ margin: 0, fontSize: 18 }}>Who accessed citizens&apos; data</h2>
            {report.people.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>No access recorded this month.</p>}
            {report.people.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Account</th><th>Office</th><th>Views</th><th>Exports and prints</th><th>Rows exported</th></tr></thead>
                  <tbody>
                    {report.people.map((p) => (
                      <tr key={`${p.who}-${p.office}`}>
                        <td style={{ fontWeight: 600 }}>{p.who}</td>
                        <td>{p.office ?? (p.role === 'admin' ? 'Administrator' : '')}</td>
                        <td>{p.views.toLocaleString()}</td>
                        <td>{p.exports.toLocaleString()}</td>
                        <td>{p.rowsExported.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="ws-card ws-card--pad ws-stack-y">
            <h2 style={{ margin: 0, fontSize: 18 }}>Exports and printed lists</h2>
            {report.exports.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>No exports this month.</p>}
            {report.exports.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>When</th><th>Account</th><th>Office</th><th>What</th><th>Rows</th></tr></thead>
                  <tbody>
                    {report.exports.map((e) => (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                        <td>{e.who}</td>
                        <td>{e.office ?? ''}</td>
                        <td>{e.what}</td>
                        <td>{e.rows?.toLocaleString() ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function DataRequestsView() {
  const [status, setStatus] = useState<DataRequest['status'] | ''>('open');
  const [rows, setRows] = useState<DataRequest[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DataRequest | null>(null);

  useEffect(() => {
    setError(null);
    setRows(null);
    api.dataRequests({ status: status || undefined }).then(setRows).catch(setError);
  }, [status, attempt]);
  const reload = () => setAttempt((n) => n + 1);

  return (
    <section className="ws-card ws-card--pad ws-stack-y">
      <div className="ws-section-head">
        <div className="grow">
          <h2 style={{ margin: 0, fontSize: 18 }}>Data requests</h2>
          <p className="ws-kpi-sub" style={{ margin: '4px 0 0' }}>Citizens asking to see, correct or delete their data, or objecting to its use. Record each one and how it was answered.</p>
        </div>
        <select className="select" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as DataRequest['status'] | '')}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="declined">Declined</option>
          <option value="">All</option>
        </select>
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Record a request</button>
      </div>
      {error != null && <LoadError what="data requests" error={error} onRetry={reload} />}
      {error == null && !rows && <span className="spinner" />}
      {rows && rows.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>No {status ? STATUS_LABEL[status].toLowerCase() : ''} requests.</p>}
      {rows && rows.length > 0 && <RequestTable rows={rows} onOpen={setEditing} />}
      {adding && (
        <Modal title="Record a data request" eyebrow="Privacy" onClose={() => setAdding(false)}>
          <DataRequestForm onSaved={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`${KIND_LABEL[editing.kind]}: ${editing.requesterName}`} eyebrow="Data request" onClose={() => setEditing(null)}>
          <DataRequestUpdate request={editing} onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </section>
  );
}

export function RequestTable({ rows, onOpen }: { rows: DataRequest[]; onOpen: (r: DataRequest) => void }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead><tr><th>Received</th><th>From</th><th>Request</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{r.receivedOn}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{r.requesterName}</div>
                {r.contact && <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{r.contact}</div>}
              </td>
              <td>
                <div>{KIND_LABEL[r.kind]}</div>
                {r.details && <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{r.details}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.status === 'open' ? `Open, ${daysSince(r.receivedOn)} days` : `${STATUS_LABEL[r.status]} ${r.closedOn ?? ''}`}
              </td>
              <td><button type="button" className="btn btn--ghost" onClick={() => onOpen(r)}>Update</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataRequestForm({ person, onSaved, onCancel }: {
  person?: { personKey: string; name: string }; onSaved: () => void; onCancel: () => void;
}) {
  const [requesterName, setRequesterName] = useState(person?.name ?? '');
  const [contact, setContact] = useState('');
  const [kind, setKind] = useState<DataRequestKind>('access');
  const [details, setDetails] = useState('');
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createDataRequest({ requesterName, personKey: person?.personKey ?? null, contact: contact || null, kind, details: details || null, receivedOn });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the request');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {person && <p className="ws-note">For the registry record of <strong>{person.name}</strong>.</p>}
      <div className="field">
        <label className="field-label" htmlFor="dr-name">Requested by</label>
        <input id="dr-name" className="input" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} required minLength={2} maxLength={200} autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dr-contact">Contact (optional)</label>
        <input id="dr-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} placeholder="Phone, email or address" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dr-kind">What they asked for</label>
        <select id="dr-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as DataRequestKind)}>
          {(Object.keys(KIND_LABEL) as DataRequestKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dr-details">Details (optional)</label>
        <textarea id="dr-details" className="textarea" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dr-received">Received on</label>
        <input id="dr-received" className="input" type="date" value={receivedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReceivedOn(e.target.value)} required />
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving...' : 'Save request'}</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function DataRequestUpdate({ request, onSaved, onCancel }: { request: DataRequest; onSaved: () => void; onCancel: () => void }) {
  const [status, setStatus] = useState<DataRequest['status']>(request.status);
  const [response, setResponse] = useState(request.response ?? '');
  const [closedOn, setClosedOn] = useState(request.closedOn ?? new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateDataRequest(request.id, { status, response: response || null, ...(status === 'open' ? {} : { closedOn }) });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the request');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, color: 'var(--t-muted)' }}>
        Received {request.receivedOn}{request.contact ? ` · ${request.contact}` : ''}{request.details ? ` · ${request.details}` : ''}
      </p>
      <div className="field">
        <label className="field-label" htmlFor="du-status">Status</label>
        <select id="du-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as DataRequest['status'])}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="declined">Declined</option>
        </select>
      </div>
      {status !== 'open' && (
        <div className="field">
          <label className="field-label" htmlFor="du-closed">Answered on</label>
          <input id="du-closed" className="input" type="date" value={closedOn} min={request.receivedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setClosedOn(e.target.value)} required />
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="du-response">What was done (or why it was declined)</label>
        <textarea id="du-response" className="textarea" rows={3} maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} required={status === 'declined'} />
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// On a citizen's profile: who viewed or changed their record, and their
// data requests.
export function CitizenPrivacySection({ personKey, name }: { personKey: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AccessEntry[] | null>(null);
  const [requests, setRequests] = useState<DataRequest[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DataRequest | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    Promise.all([api.accessHistory(personKey), api.dataRequests({ personKey })])
      .then(([h, r]) => { setEntries(h.entries); setRequests(r); })
      .catch(setError);
  }, [open, personKey, attempt]);
  const reload = () => setAttempt((n) => n + 1);

  return (
    <div className="ws-card ws-card--pad ws-stack-y">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>Privacy</h2>
        <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>Record a data request</button>
        <button type="button" className="btn btn--ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide access history' : 'Who viewed or changed this record'}
        </button>
      </div>
      {open && error != null && <LoadError what="the access history" error={error} onRetry={reload} />}
      {open && error == null && !entries && <span className="spinner" />}
      {open && requests && requests.length > 0 && <RequestTable rows={requests} onOpen={setEditing} />}
      {open && entries && (
        <>
          {entries.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>Nothing recorded yet.</p>}
          <div>
            {entries.map((e) => (
              <div key={e.id} className="ws-kv-row">
                <span>
                  <span style={{ fontWeight: 600 }}>{e.who}</span>
                  <span style={{ color: 'var(--t-muted)' }}>{e.office ? `, ${e.office}` : e.role === 'admin' ? ', Administrator' : ''}</span>
                  <span style={{ display: 'block' }}>{e.what}</span>
                </span>
                <span style={{ color: 'var(--t-muted)', whiteSpace: 'nowrap' }}>{when(e.at)}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--t-muted)' }}>
            Shows profile and household views, office record changes and documents opened, and Program gaps or Disaster list pages that listed this person. City-wide CSV exports are not tracked per person; they are in Privacy, Access report.
          </p>
        </>
      )}
      {adding && (
        <Modal title="Record a data request" eyebrow="Privacy" onClose={() => setAdding(false)}>
          <DataRequestForm person={{ personKey, name }} onSaved={() => { setAdding(false); setOpen(true); reload(); }} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`${KIND_LABEL[editing.kind]}: ${editing.requesterName}`} eyebrow="Data request" onClose={() => setEditing(null)}>
          <DataRequestUpdate request={editing} onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
