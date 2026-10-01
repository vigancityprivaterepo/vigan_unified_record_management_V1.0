import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { api, ApiError, type DisasterBarangay, type DisasterCategory, type Paginated, type VulnerablePerson } from '@/lib/api';

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

export function DisasterListsPage() {
  const [data, setData] = useState<{ totals: DisasterBarangay; barangays: DisasterBarangay[]; usesSampleData: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [scope, setScope] = useState<Scope | null>(null);
  const [printing, setPrinting] = useState<Scope | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.disasterSummary().then(setData).catch((err) => { setData(null); setError(err); });
  }, [attempt]);

  async function exportAll() {
    setExporting(true);
    setExportError(null);
    try {
      await api.exportDisasterList();
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
          <h1>Disaster lists</h1>
          <p className="ws-kpi-sub" style={{ margin: '6px 0 0', maxWidth: 760 }}>
            Residents who may need help to evacuate before a typhoon or flood: seniors 60 and older, children under 5, persons with disability, pregnant women and solo parents. Print one barangay&apos;s list for the barangay captain and rescue teams.
          </p>
        </div>
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
                      <th>Evacuated now</th><th />
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

      {scope && <PeopleModal scope={scope} onPrint={() => setPrinting(scope)} onClose={() => setScope(null)} />}
      {printing?.code && <PrintSheet scope={printing as Scope & { code: string }} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function PeopleModal({ scope, onPrint, onClose }: { scope: Scope; onPrint: () => void; onClose: () => void }) {
  const [category, setCategory] = useState<DisasterCategory | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<VulnerablePerson> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.disasterPeople(page, scope.code ?? undefined, category).then(setResult).catch((err) => { setResult(null); setError(err); });
  }, [scope.code, category, page, attempt]);

  function pick(c: DisasterCategory | undefined) {
    setCategory(c);
    setPage(1);
  }

  async function exportCsv() {
    setExportError(null);
    try {
      await api.exportDisasterList(scope.code ?? undefined, category);
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
                  <tr><th>Name</th><th>Age</th><th>Sex</th><th>Needs</th>{!scope.code && <th>Barangay</th>}<th>Street</th><th>Evacuation center now</th></tr>
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
    </Modal>
  );
}

// Printed sheet for one barangay: rendered outside the app root and shown
// only by @media print (workspace.css), then removed after printing.
function PrintSheet({ scope, onDone }: { scope: Scope & { code: string }; onDone: () => void }) {
  const [rows, setRows] = useState<{ total: number; items: VulnerablePerson[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent passes a new onDone each render; keep the latest in a ref so
  // the print effect below runs once per loaded list, not once per render.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    api.disasterPrint(scope.code).then(setRows).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the list to print'));
  }, [scope.code]);

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
        <div className="dl-print-warn">Confidential: contains sensitive personal information (RA 10173). For disaster response only. Do not post or share.</div>
        {rows.truncated && <div className="dl-print-warn">Only the first {rows.items.length} people are printed. Export the CSV for the full list.</div>}
      </div>
      <table>
        <thead><tr><th>Name</th><th>Age</th><th>Sex</th><th>Needs</th><th>Street</th><th>Evacuated to</th><th>Reached</th></tr></thead>
        {[...households.values()].map((members) => (
          <tbody key={members[0]!.householdKey}>
            <tr className="dl-print-hh"><td colSpan={7}>Household of {members[0]!.householdHead ?? members[0]!.name}</td></tr>
            {members.map((p) => (
              <tr key={p.personKey}>
                <td>{p.name}</td><td>{p.age ?? ''}</td><td>{p.sex ?? ''}</td><td>{needsText(p)}</td>
                <td>{p.street ?? ''}</td><td>{p.evacuationCenter ?? ''}</td><td className="dl-print-box" />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>,
    document.body,
  );
}
