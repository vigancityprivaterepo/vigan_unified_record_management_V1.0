import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { defaultFieldValues, DynamicExtraFields, toSubmitValues, type FieldValue, type FieldValues } from '@/components/DynamicExtraFields';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { api, ApiError, type DisasterBarangay, type DisasterCategory, type OfficeFormField, type ReliefEvent, type ReliefFilter, type Paginated, type VulnerablePerson } from '@/lib/api';

// Disaster lists for CDRRMO: residents who may need help to evacuate, per
// barangay and household. Definitions live in backend/src/services/
// disasterLists.ts and are repeated in plain words on the page.
const NEEDS: Array<{ key: DisasterCategory; label: string; plural: string }> = [
  { key: 'senior', label: 'Senior (60+)', plural: 'Seniors' },
  { key: 'young_child', label: 'Child under 5', plural: 'Under 5' },
  { key: 'pwd', label: 'PWD', plural: 'PWD' },
  { key: 'pregnant', label: 'Pregnant', plural: 'Pregnant' },
  { key: 'solo_parent', label: 'Solo parent', plural: 'Solo parents' },
];
const needLabel = (k: DisasterCategory) => NEEDS.find((n) => n.key === k)?.label ?? k;
// "Pregnant (check record)" when the record looks wrong (see the backend).
const needsText = (p: VulnerablePerson) =>
  p.needs.map((k) => (k === 'pregnant' && p.pregnancyNeedsCheck ? 'Pregnant (check record)' : needLabel(k))).join(', ');

type Scope = { code: string | null; name: string };

// officeId set = the office that runs Evacuees (CDRRMO), whole city.
export function DisasterListsPage({ officeId }: { officeId?: string } = {}) {
  const [data, setData] = useState<{ totals: DisasterBarangay; barangays: DisasterBarangay[]; usesSampleData: boolean; reliefEvents: ReliefEvent[] } | null>(null);
  // A relief event picked here adds "received relief" counts and filters.
  const [event, setEvent] = useState('');
  // The office's Relief Distribution form, when it has one: then relief can
  // be marked as received straight from the lists, and a new event started.
  const [reliefForm, setReliefForm] = useState<{ moduleId: string; name: string; fields: OfficeFormField[] } | null>(null);
  const [newEvent, setNewEvent] = useState<string | null>(null);
  useEffect(() => {
    if (officeId) api.reliefForm(officeId).then(setReliefForm).catch(() => setReliefForm(null));
  }, [officeId]);
  const known = data?.reliefEvents.find((e) => e.event === event);
  const eventLabel = known?.label ?? (event || undefined);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [scope, setScope] = useState<Scope | null>(null);
  const [printing, setPrinting] = useState<Scope | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.disasterSummary(officeId, event || undefined).then(setData).catch((err) => { setData(null); setError(err); });
  }, [officeId, event, attempt]);

  async function exportAll() {
    setExporting(true);
    setExportError(null);
    try {
      await api.exportDisasterList(officeId, undefined, undefined, { event: event || undefined });
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const t = data?.totals;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>Disaster lists</h1>        </div>
        <button type="button" className="btn btn--ghost btn--lg" onClick={exportAll} disabled={exporting || !t?.people}>
          <Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export all (CSV)'}
        </button>
      </div>
      {exportError && <div className="alert danger"><div className="body">{exportError}</div></div>}
      {error != null && <LoadError what="the disaster lists" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {error == null && !data && <span className="spinner" />}

      {data && t && (
        <>
          {data.usesSampleData && <p className="ws-note">Some of these programs contain sample data, so the counts below are not real yet.</p>}
          <div className="dl-event">
            <label className="field-label" htmlFor="dl-event" style={{ margin: 0 }}>Relief event</label>
            {newEvent === null ? (
              <select id="dl-event" className="select" value={event} onChange={(e) => (e.target.value === '__new' ? setNewEvent('') : setEvent(e.target.value))}>
                <option value="">None chosen</option>
                {event && !known && <option value={event}>{event} (new, nothing recorded yet)</option>}
                {data.reliefEvents.map((ev) => (
                  <option key={ev.event} value={ev.event}>{ev.label} ({ev.households.toLocaleString()} {ev.households === 1 ? 'household' : 'households'} served{ev.lastDate ? `, last ${ev.lastDate}` : ''})</option>
                ))}
                {reliefForm && <option value="__new">Start a new relief event...</option>}
              </select>
            ) : (
              <form className="dl-new-event" onSubmit={(e) => { e.preventDefault(); if (newEvent.trim()) { setEvent(newEvent.trim()); setNewEvent(null); } }}>
                <input id="dl-event" className="input" autoFocus value={newEvent} maxLength={120} placeholder="Event name, e.g. Typhoon Kristine" onChange={(e) => setNewEvent(e.target.value)} />
                <button type="submit" className="btn btn--primary" disabled={!newEvent.trim()}>Use this event</button>
                <button type="button" className="btn btn--ghost" onClick={() => setNewEvent(null)}>Cancel</button>
              </form>
            )}
            <span className="ws-kpi-sub">
              {reliefForm
                ? event
                  ? 'Open a barangay and use "Mark received" as each household gets relief.'
                  : 'Choose an event, or start a new one, then mark households as they receive relief.'
                : data.reliefEvents.length === 0
                  ? 'No relief has been recorded yet. CDRRMO records it from its own Disaster lists.'
                  : 'Choose an event to see which of these households have not received relief yet.'}
            </span>
          </div>
          <div className="ws-kpis">
            <div className="ws-card ws-kpi">
              <span className="ws-kpi-label">Residents who may need help</span>
              <span className="ws-kpi-value">{t.people.toLocaleString()}</span>
              <span className="ws-kpi-sub">in {t.households.toLocaleString()} households</span>
            </div>
            <div className="ws-card ws-kpi">
              <span className="ws-kpi-label">In an evacuation center now</span>
              <span className="ws-kpi-value">{t.evacuatedNow.toLocaleString()}</span>
              <span className="ws-kpi-sub">not yet marked as returned home</span>
            </div>
            {event && (
              <div className="ws-card ws-kpi">
                <span className="ws-kpi-label">Not yet reached by this relief</span>
                <span className="ws-kpi-value">{(t.households - t.reliefHouseholds).toLocaleString()}</span>
                <span className="ws-kpi-sub">of {t.households.toLocaleString()} households ({(t.people - t.reliefPeople).toLocaleString()} people)</span>
              </div>
            )}
            <div className="ws-card ws-kpi" style={{ gridColumn: 'span 2' }}>
              <span className="ws-kpi-label">By need (a person can have more than one)</span>
              <div className="dl-needs">
                {NEEDS.map((n) => (
                  <span key={n.key}><strong>{t[n.key].toLocaleString()}</strong> {n.plural}</span>
                ))}
              </div>
            </div>
          </div>

          <section className="ws-card ws-card--pad ws-stack-y">
            <div className="ws-section-head">
              <div className="grow">
                <h2 style={{ margin: 0, fontSize: 18 }}>By barangay</h2>
                <p className="ws-kpi-sub" style={{ margin: '4px 0 0' }}>Barangays with the most residents who may need help come first. Barangays with none are not listed.</p>
              </div>
              <button type="button" className="btn btn--ghost" onClick={() => setScope({ code: null, name: 'All barangays' })} disabled={!t.people}>View everyone</button>
            </div>
            {data.barangays.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>No residents in the registry match these needs yet.</p>}
            {data.barangays.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Barangay</th><th>People</th><th>Households</th>
                      {NEEDS.map((n) => <th key={n.key}>{n.plural}</th>)}
                      <th>Evacuated now</th>{event && <th>Not yet reached</th>}<th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.barangays.map((b) => {
                      const s: Scope = { code: b.code, name: b.name ?? 'No barangay' };
                      return (
                        <tr key={b.code ?? 'none'}>
                          <td style={{ fontWeight: 600 }}>{s.name}</td>
                          <td><strong>{b.people}</strong></td>
                          <td>{b.households}</td>
                          {NEEDS.map((n) => <td key={n.key}>{b[n.key] || ''}</td>)}
                          <td>{b.evacuatedNow || ''}</td>
                          {event && <td><strong>{b.households - b.reliefHouseholds}</strong> of {b.households}</td>}
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <button type="button" className="btn btn--ghost" onClick={() => setScope(s)}>View</button>{' '}
                            {b.code && <button type="button" className="btn btn--ghost" onClick={() => setPrinting(s)} aria-label={`Print list for ${s.name}`}>Print</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {scope && <PeopleModal officeId={officeId} event={event || undefined} eventLabel={eventLabel} reliefForm={reliefForm} onReliefSaved={() => setAttempt((n) => n + 1)} scope={scope} onPrint={() => setPrinting(scope)} onClose={() => setScope(null)} />}
      {printing?.code && <PrintSheet officeId={officeId} event={event || undefined} eventLabel={eventLabel} scope={printing as Scope & { code: string }} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function PeopleModal({ officeId, event, eventLabel, reliefForm, onReliefSaved, scope, onPrint, onClose }: {
  officeId?: string; event?: string; eventLabel?: string; scope: Scope; onPrint: () => void; onClose: () => void;
  reliefForm?: { moduleId: string; name: string; fields: OfficeFormField[] } | null; onReliefSaved?: () => void;
}) {
  const [marking, setMarking] = useState<VulnerablePerson | null>(null);
  const [category, setCategory] = useState<DisasterCategory | undefined>(undefined);
  const [relief, setRelief] = useState<ReliefFilter['relief']>(undefined);
  const rf: ReliefFilter = event ? { event, relief } : {};
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<VulnerablePerson> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.disasterPeople(officeId, page, scope.code ?? undefined, category, rf).then(setResult).catch((err) => { setResult(null); setError(err); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rf is derived from event + relief
  }, [officeId, scope.code, category, event, relief, page, attempt]);

  function pick(c: DisasterCategory | undefined) {
    setCategory(c);
    setPage(1);
  }

  async function exportCsv() {
    setExportError(null);
    try {
      await api.exportDisasterList(officeId, scope.code ?? undefined, category, rf);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    }
  }

  let lastHousehold = '';
  return (
    <Modal title={scope.name} eyebrow="Disaster list" onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={`ws-chip${category ? '' : ' is-on'}`} onClick={() => pick(undefined)}>Everyone</button>
          {NEEDS.map((n) => (
            <button key={n.key} type="button" className={`ws-chip${category === n.key ? ' is-on' : ''}`} onClick={() => pick(n.key)}>{n.plural}</button>
          ))}
          {event && (
            <select className="select" style={{ width: 'auto' }} aria-label="Relief" value={relief ?? ''}
              onChange={(e) => { setRelief((e.target.value || undefined) as ReliefFilter['relief']); setPage(1); }}>
              <option value="">Relief: everyone</option>
              <option value="not_received">Not yet reached</option>
              <option value="received">Already received</option>
            </select>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={exportCsv} disabled={!result?.total}><Icon name="download" size={16} /> Export CSV</button>
          {scope.code && <button type="button" className="btn btn--primary" onClick={onPrint}>Print list</button>}
        </div>
        {exportError && <div className="alert danger"><div className="body">{exportError}</div></div>}
        {error != null && <LoadError what="this list" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
        {error == null && !result && <span className="spinner" />}
        {result && (
          <>
            <strong>{result.total.toLocaleString()} {result.total === 1 ? 'person' : 'people'}</strong>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Age</th><th>Sex</th><th>Needs</th>{!scope.code && <th>Barangay</th>}<th>Street</th><th>Evacuation center now</th>{event && <th>Relief: {eventLabel ?? event}</th>}</tr>
                </thead>
                <tbody>
                  {result.items.map((p) => {
                    const newHousehold = p.householdKey !== lastHousehold;
                    lastHousehold = p.householdKey;
                    return (
                      <tr key={p.personKey} className={newHousehold ? 'dl-hh-start' : undefined}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          {newHousehold && p.householdHead && p.householdKey !== p.personKey && <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>Household of {p.householdHead}</div>}
                        </td>
                        <td>{p.age ?? 'Not on file'}</td>
                        <td>{p.sex ?? ''}</td>
                        <td>{needsText(p)}</td>
                        {!scope.code && <td>{p.barangay ?? 'No barangay'}</td>}
                        <td>{p.street ?? ''}</td>
                        <td>{p.evacuationCenter ?? ''}</td>
                        {event && (
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {p.reliefReceived ? 'Received' : <strong>Not yet</strong>}
                            {!p.reliefReceived && newHousehold && reliefForm && officeId && (
                              <> <button type="button" className="btn btn--ghost dl-mark" onClick={() => setMarking(p)}>Mark received</button></>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPageChange={setPage} />
          </>
        )}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--t-muted)' }}>
          This list includes disability and pregnancy, which are sensitive personal information (RA 10173). Opening, printing and exporting it is recorded in the audit log. Use it only for disaster response.
        </p>
      </div>
      {marking && reliefForm && officeId && event && (
        <Modal title="Mark relief as received" eyebrow={eventLabel ?? event} onClose={() => setMarking(null)}>
          <MarkReliefForm
            officeId={officeId}
            person={marking}
            eventLabel={eventLabel ?? event}
            fields={reliefForm.fields}
            onCancel={() => setMarking(null)}
            onSaved={() => { setMarking(null); setAttempt((n) => n + 1); onReliefSaved?.(); }}
          />
        </Modal>
      )}
    </Modal>
  );
}

// Printed sheet for one barangay: rendered outside the app root and shown
// only by @media print (workspace.css), then removed after printing.
function PrintSheet({ officeId, event, eventLabel, scope, onDone }: { officeId?: string; event?: string; eventLabel?: string; scope: Scope & { code: string }; onDone: () => void }) {
  const [rows, setRows] = useState<{ total: number; items: VulnerablePerson[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent passes a new onDone each render; keep the latest in a ref so
  // the print effect below runs once per loaded list, not once per render.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    api.disasterPrint(officeId, scope.code, event ? { event } : {}).then(setRows).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the list to print'));
  }, [officeId, scope.code, event]);

  useEffect(() => {
    if (!rows) return;
    const after = () => done.current();
    window.addEventListener('afterprint', after);
    // Let the sheet render before the print dialog opens.
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, [rows]);

  if (error) {
    return (
      <Modal title="Could not print" onClose={onDone}>
        <div className="alert danger"><div className="body">{error}</div></div>
      </Modal>
    );
  }
  if (!rows) return null;

  const households = new Map<string, VulnerablePerson[]>();
  for (const p of rows.items) households.set(p.householdKey, [...(households.get(p.householdKey) ?? []), p]);
  const printed = new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });

  return createPortal(
    <div className="dl-print">
      <div className="dl-print-head">
        <div>City Government of Vigan · City Disaster Risk Reduction and Management Office</div>
        <h1>Residents who may need help to evacuate</h1>
        <div><strong>{scope.name}</strong> · {rows.total} {rows.total === 1 ? 'person' : 'people'} in {households.size} {households.size === 1 ? 'household' : 'households'} · printed {printed}</div>
        {event && <div>Relief event: <strong>{eventLabel ?? event}</strong></div>}
        <div className="dl-print-warn">Confidential: contains sensitive personal information (RA 10173). For disaster response only. Do not post or share.</div>
        {rows.truncated && <div className="dl-print-warn">Only the first {rows.items.length} people are printed. Export the CSV for the full list.</div>}
      </div>
      <table>
        <thead><tr><th>Name</th><th>Age</th><th>Sex</th><th>Needs</th><th>Street</th><th>Evacuated to</th>{event && <th>Relief received</th>}<th>Reached</th></tr></thead>
        {[...households.values()].map((members) => (
          <tbody key={members[0]!.householdKey}>
            <tr className="dl-print-hh"><td colSpan={event ? 8 : 7}>Household of {members[0]!.householdHead ?? members[0]!.name}</td></tr>
            {members.map((p) => (
              <tr key={p.personKey}>
                <td>{p.name}</td><td>{p.age ?? ''}</td><td>{p.sex ?? ''}</td><td>{needsText(p)}</td>
                <td>{p.street ?? ''}</td><td>{p.evacuationCenter ?? ''}</td>{event && <td>{p.reliefReceived ? 'Yes' : 'Not yet'}</td>}<td className="dl-print-box" />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>,
    document.body,
  );
}

// "Mark received": the office's own Relief Distribution form for one
// person, with the event filled in. The server refuses a second claim from
// the same household for the same event and says who already received.
function MarkReliefForm({ officeId, person, eventLabel, fields, onSaved, onCancel }: {
  officeId: string; person: VulnerablePerson; eventLabel: string; fields: OfficeFormField[]; onSaved: () => void; onCancel: () => void;
}) {
  const shown = fields.filter((f) => f.key !== 'event');
  const [values, setValues] = useState<FieldValues>(() => {
    const v = defaultFieldValues(shown);
    if ('distribution_date' in v) v.distribution_date = new Date().toISOString().slice(0, 10);
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.markReliefReceived(officeId, person.personKey, { ...toSubmitValues(shown, values), event: eventLabel });
      onSaved();
    } catch (err) {
      const d = err instanceof ApiError ? (err.details as { fieldErrors?: Record<string, string[]> } | null) : null;
      const first = d?.fieldErrors ? Object.entries(d.fieldErrors)[0] : undefined;
      const label = first ? fields.find((f) => f.key === first[0])?.label ?? first[0] : null;
      setError(first ? `${label}: ${first[1].join(', ')}` : err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p className="ws-note">
        <strong>{person.householdHead ? `Household of ${person.householdHead}` : person.name}</strong>
        {person.barangay ? `, ${person.barangay}` : ''}. One claim per household for <strong>{eventLabel}</strong>.
      </p>
      <DynamicExtraFields fields={shown} values={values} onChange={(key: string, value: FieldValue) => setValues((v) => ({ ...v, [key]: value }))} />
      {error && <div className="alert danger"><div className="body">{error}</div></div>}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving...' : 'Save as received'}</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
