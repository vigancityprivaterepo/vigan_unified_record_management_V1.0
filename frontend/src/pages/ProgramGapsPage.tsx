import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Checkbox } from '@/components/Checkbox';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { OfficeMark } from '@/components/OfficeMark';
import { Pagination } from '@/components/Pagination';
import { useViewOnly } from '@/lib/viewOnly';
import { api, ApiError, type GapPerson, type GapRuleInput, type GapRuleSummary, type OutreachFilter, type OutreachStatus, type Paginated } from '@/lib/api';

type Program = { id: string; name: string; officeName: string };

// Program gaps: who qualifies for a program but isn't on it ("Not yet
// served"), and who is on a list they shouldn't be on ("Needs cleanup").
// Rules live in program_gap_rule and are computed live by the backend each
// time this page loads. Nothing here changes a record.
// officeId set = an office's own view: only rules that target its programs,
// read-only (admin manages rules).
export function ProgramGapsPage({ officeId }: { officeId?: string } = {}) {
  const [data, setData] = useState<{ rules: GapRuleSummary[]; programs: Program[] } | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [barangays, setBarangays] = useState<Array<{ code: string; name: string }>>([]);
  const [barangayCode, setBarangayCode] = useState('');
  const [openRule, setOpenRule] = useState<GapRuleSummary | null>(null);
  const [managing, setManaging] = useState(false);
  // A view-only account sees the counts; the names behind them stay closed.
  const viewOnly = useViewOnly();

  useEffect(() => {
    api.barangays().then(setBarangays).catch(() => setBarangays([]));
  }, []);
  useEffect(() => {
    setLoadError(null);
    api.programGaps(officeId, barangayCode || undefined).then(setData).catch((err) => { setData(null); setLoadError(err); });
  }, [officeId, barangayCode, attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const active = data?.rules.filter((r) => r.isActive) ?? [];
  const missing = active.filter((r) => r.kind === 'missing');
  const conflict = active.filter((r) => r.kind === 'conflict');
  const barangayName = barangays.find((b) => b.code === barangayCode)?.name;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>Program gaps</h1>
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 200 }} aria-label="Filter by barangay" value={barangayCode} onChange={(e) => setBarangayCode(e.target.value)}>
          <option value="">All barangays</option>
          {barangays.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        {!officeId && !viewOnly && (
          <button type="button" className="btn btn--ghost btn--lg" onClick={() => setManaging(true)}>
            <Icon name="sliders" size={16} /> Manage rules
          </button>
        )}
      </div>

      {loadError != null && <LoadError what="program gaps" error={loadError} onRetry={reload} />}
      {loadError == null && !data && <span className="spinner" />}

      {data && (
        <>
          <GapSection
            title="Not yet served"
            sub={viewOnly ? "Citizens who match a program's conditions but have no record in it, and how many have been contacted so far." : "Citizens who match a program's conditions but have no record in it. Open a list to print it for a barangay and mark who has been contacted."}
            rules={missing}
            empty={officeId ? 'No rules of this kind for your programs.' : 'No active rules of this kind. Add one under Manage rules.'}
            onOpen={viewOnly ? undefined : setOpenRule}
          />
          <GapSection
            title="Needs cleanup"
            sub="People who are still on a list they should no longer be on. Check these before the next payout or report."
            rules={conflict}
            empty={officeId ? 'No cleanup rules for your programs.' : 'No active cleanup rules.'}
            onOpen={viewOnly ? undefined : setOpenRule}
          />
        </>
      )}

      {openRule && <GapPeopleModal officeId={officeId} rule={openRule} barangayCode={barangayCode} barangayName={barangayName} onClose={() => { setOpenRule(null); reload(); }} />}
      {managing && data && <ManageRulesModal rules={data.rules} programs={data.programs} onChanged={reload} onClose={() => setManaging(false)} />}
    </div>
  );
}

function GapSection({ title, sub, rules, empty, onOpen }: {
  title: string; sub: string; rules: GapRuleSummary[]; empty: string; onOpen?: (r: GapRuleSummary) => void;
}) {
  return (
    <section className="ws-card ws-card--pad ws-stack-y">
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <p className="ws-kpi-sub" style={{ margin: '4px 0 0' }}>{sub}</p>
      </div>
      {rules.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>{empty}</p>}
      <div>
        {rules.map((r) => (
          <button key={r.id} type="button" className="ws-gap-row" onClick={() => onOpen?.(r)} disabled={!r.total || !onOpen} style={onOpen ? undefined : { color: 'inherit' }}>
            {r.targetProgram ? (
              <OfficeMark name={r.targetProgram.office.name} hue={r.targetProgram.office.accentHue} icon={r.targetProgram.office.icon} />
            ) : <span />}
            <span style={{ minWidth: 0 }}>
              <span className="ws-gap-name">
                {r.name}
                {r.usesSampleData && <span className="ws-sample-tag">Sample data</span>}
              </span>
              <span className="ws-gap-desc">{r.description ?? describeRule(r)}</span>
            </span>
            <span className="ws-gap-count">
              <strong>{r.total == null ? 'N/A' : r.total === 0 ? 'None' : r.total.toLocaleString()}</strong>
              {!!r.total && <span>{r.total === 1 ? 'person' : 'people'}</span>}
              {!!r.total && r.outreach && <span>{contacted(r.outreach).toLocaleString()} contacted</span>}
            </span>
            {r.total && onOpen ? <Icon name="chevR" size={16} /> : <span />}
          </button>
        ))}
      </div>
    </section>
  );
}

const OUTREACH: Array<[OutreachStatus, string]> = [
  ['reached', 'Reached, will come in'],
  ['declined', 'Reached, does not want it'],
  ['not_found', 'Could not be found'],
  ['moved', 'No longer lives here'],
];
const contacted = (o: Record<OutreachStatus, number>) => o.reached + o.declined + o.not_found + o.moved;

function describeRule(r: Pick<GapRuleSummary, 'kind' | 'minAge' | 'maxAge' | 'sex' | 'sourcePrograms' | 'targetProgram'>): string {
  const who: string[] = [];
  if (r.minAge != null && r.maxAge != null) who.push(`aged ${r.minAge} to ${r.maxAge}`);
  else if (r.minAge != null) who.push(`aged ${r.minAge} or older`);
  else if (r.maxAge != null) who.push(`aged ${r.maxAge} or younger`);
  if (r.sex) who.push(r.sex === 'F' ? 'female' : 'male');
  if (r.sourcePrograms.length) who.push(`in ${r.sourcePrograms.join(' or ')}`);
  const target = r.targetProgram?.name ?? 'the program';
  return `Citizens ${who.join(', ') || 'in the registry'} who are ${r.kind === 'missing' ? 'not' : 'still'} in ${target}.`;
}

function GapPeopleModal({ officeId, rule, barangayCode, barangayName, onClose }: {
  officeId?: string; rule: GapRuleSummary; barangayCode: string; barangayName?: string; onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<GapPerson> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Outreach is for people still waiting to be served, not for cleanup lists.
  const tracks = rule.kind === 'missing';
  const [show, setShow] = useState<OutreachFilter | ''>('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    setError(null);
    api.programGapPeople(officeId, rule.id, page, barangayCode || undefined, show || undefined).then(setResult).catch((err) => { setResult(null); setError(err); });
  }, [officeId, rule.id, page, barangayCode, show, attempt]);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      await api.exportProgramGap(officeId, rule.id, barangayCode || undefined, show || undefined);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // Saves right away; the row keeps its place so staff can go down the list.
  async function mark(p: GapPerson, status: OutreachStatus | null, note: string | null) {
    setSavingKey(p.personKey);
    setExportError(null);
    try {
      await api.setGapOutreach(officeId, rule.id, p.personKey, status, note);
      const today = new Date().toISOString().slice(0, 10);
      setResult((r) => r && { ...r, items: r.items.map((x) => (x.personKey === p.personKey ? { ...x, outreach: status ? { status, note, on: today } : null } : x)) });
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Could not save the result');
    } finally {
      setSavingKey(null);
    }
  }

  const eyebrow = rule.targetProgram ? `${rule.targetProgram.office.shortName || rule.targetProgram.office.name} · ${rule.targetProgram.name}` : undefined;
  return (
    <Modal title={rule.name} eyebrow={eyebrow} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, color: 'var(--t-muted)' }}>
          {rule.description ?? describeRule(rule)}
          {barangayName ? ` Showing ${barangayName} only.` : ''}
        </p>
        {rule.usesSampleData && <p className="ws-note">These programs contain sample data, so this list is not real yet.</p>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{result ? `${result.total.toLocaleString()} ${result.total === 1 ? 'person' : 'people'}` : ''}</strong>
          {tracks && (
            <select className="select" style={{ width: 'auto' }} aria-label="Show by outreach result" value={show} onChange={(e) => { setShow(e.target.value as OutreachFilter | ''); setPage(1); }}>
              <option value="">Everyone on the list</option>
              <option value="todo">Not yet contacted</option>
              <option value="done">Contacted</option>
              {OUTREACH.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost" onClick={() => setPrinting(true)} disabled={!result?.total}>Print list</button>
          <button type="button" className="btn btn--ghost" onClick={handleExport} disabled={exporting || !result?.total}>
            <Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
        {exportError && <div className="alert danger"><div className="body">{exportError}</div></div>}
        {error != null && <LoadError what="this list" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
        {error == null && !result && <span className="spinner" />}
        {result && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Age</th><th>Sex</th><th>Barangay</th>{rule.sourcePrograms.length > 0 && <th>Found in</th>}{tracks && <th>Outreach</th>}</tr>
              </thead>
              <tbody>
                {result.items.map((p) => (
                  <tr key={p.personKey}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{p.age ?? 'Not on file'}</td>
                    <td>{p.sex ?? 'Not on file'}</td>
                    <td>{p.barangay ?? 'No barangay'}</td>
                    {rule.sourcePrograms.length > 0 && <td>{p.sourcePrograms.join(', ')}</td>}
                    {tracks && (
                      <td style={{ minWidth: 230 }}>
                        <select className="select" aria-label={`Outreach result for ${p.name}`} value={p.outreach?.status ?? ''} disabled={savingKey === p.personKey}
                          onChange={(e) => mark(p, (e.target.value || null) as OutreachStatus | null, p.outreach?.note ?? null)}>
                          <option value="">Not yet contacted</option>
                          {OUTREACH.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                        </select>
                        {p.outreach && (
                          <input className="input" style={{ marginTop: 6 }} aria-label={`Note for ${p.name}`} placeholder={`Note (marked ${p.outreach.on})`} maxLength={300}
                            defaultValue={p.outreach.note ?? ''} key={`${p.personKey}-${p.outreach.status}`}
                            onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (p.outreach?.note ?? null)) void mark(p, p.outreach!.status, v); }} />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPageChange={setPage} />}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--t-muted)' }}>
          Opening, printing and exporting this list is recorded in the audit log. Use it only to reach these people for this program.
          {tracks && ' A person leaves the list on their own once they are registered in the program.'}
        </p>
      </div>
      {printing && <CallSheet officeId={officeId} rule={rule} barangayCode={barangayCode} barangayName={barangayName} show={show} onDone={() => setPrinting(false)} />}
    </Modal>
  );
}

// Printed call list: rendered outside the app root and shown only by
// @media print (workspace.css, shared with the disaster lists), then removed.
function CallSheet({ officeId, rule, barangayCode, barangayName, show, onDone }: {
  officeId?: string; rule: GapRuleSummary; barangayCode: string; barangayName?: string; show: OutreachFilter | ''; onDone: () => void;
}) {
  const [rows, setRows] = useState<{ items: GapPerson[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    api.printProgramGap(officeId, rule.id, barangayCode || undefined, show || undefined).then(setRows).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the list to print'));
  }, [officeId, rule.id, barangayCode, show]);

  useEffect(() => {
    if (!rows) return;
    const after = () => done.current();
    window.addEventListener('afterprint', after);
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

  const tracks = rule.kind === 'missing';
  const printed = new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });
  return createPortal(
    <div className="dl-print">
      <div className="dl-print-head">
        <div>City Government of Vigan{rule.targetProgram ? ` · ${rule.targetProgram.office.name}` : ''}</div>
        <h1>{rule.name}</h1>
        <div><strong>{barangayName ?? 'All barangays'}</strong> · {rows.items.length} {rows.items.length === 1 ? 'person' : 'people'} · printed {printed}</div>
        <div className="dl-print-warn">Confidential: personal information (RA 10173). For reaching these people for this program only. Do not post or share.</div>
        {rows.truncated && <div className="dl-print-warn">Only the first {rows.items.length} people are printed. Export the CSV for the full list.</div>}
      </div>
      <table>
        <thead>
          <tr><th>#</th><th>Name</th><th>Age</th><th>Sex</th><th>Street</th>{!barangayName && <th>Barangay</th>}{tracks && <th>Result so far</th>}<th>Result of this visit</th><th>Signature</th></tr>
        </thead>
        <tbody>
          {rows.items.map((p, i) => (
            <tr key={p.personKey}>
              <td>{i + 1}</td><td>{p.name}</td><td>{p.age ?? ''}</td><td>{p.sex ?? ''}</td><td>{p.street ?? ''}</td>
              {!barangayName && <td>{p.barangay ?? ''}</td>}
              {tracks && <td>{p.outreach ? OUTREACH.find(([key]) => key === p.outreach!.status)?.[1] : ''}</td>}
              <td style={{ width: '90pt' }} /><td style={{ width: '70pt' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

const BLANK: GapRuleInput = { name: '', description: null, kind: 'missing', targetModuleId: '', sourceModuleIds: [], minAge: null, maxAge: null, sex: null, isActive: true };

function ManageRulesModal({ rules, programs, onChanged, onClose }: {
  rules: GapRuleSummary[]; programs: Program[]; onChanged: () => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string | null; input: GapRuleInput } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(r: GapRuleSummary, on: boolean) {
    setBusyId(r.id);
    setError(null);
    try {
      await api.updateProgramGapRule(r.id, { isActive: on });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the rule');
    } finally {
      setBusyId(null);
    }
  }

  const toInput = (r: GapRuleSummary): GapRuleInput => ({
    name: r.name, description: r.description, kind: r.kind, targetModuleId: r.targetModuleId, sourceModuleIds: r.sourceModuleIds,
    minAge: r.minAge, maxAge: r.maxAge, sex: r.sex, isActive: r.isActive,
  });

  return (
    <Modal title="Manage rules" eyebrow="Program gaps" onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <p style={{ margin: 0, color: 'var(--t-muted)', flex: 1 }}>Switch a rule off to hide it from the page. Rules are kept, never deleted.</p>
          <button type="button" className="btn btn--primary" onClick={() => setEditing({ id: null, input: BLANK })}>
            <Icon name="plus" size={16} /> New rule
          </button>
        </div>
        {error && <div className="alert danger"><div className="body">{error}</div></div>}
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Rule</th><th>Type</th><th>Active</th><th /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{describeRule(r)}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.kind === 'missing' ? 'Not yet served' : 'Needs cleanup'}</td>
                  <td><Checkbox label={r.isActive ? 'On' : 'Off'} checked={r.isActive} disabled={busyId === r.id} onChange={(on) => toggle(r, on)} /></td>
                  <td><button type="button" className="btn btn--ghost" onClick={() => setEditing({ id: r.id, input: toInput(r) })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <Modal title={editing.id ? 'Edit rule' : 'New rule'} eyebrow="Program gaps" onClose={() => setEditing(null)}>
          <RuleForm
            id={editing.id}
            initial={editing.input}
            programs={programs}
            onSaved={() => { setEditing(null); onChanged(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </Modal>
  );
}

function RuleForm({ id, initial, programs, onSaved, onCancel }: {
  id: string | null; initial: GapRuleInput; programs: Program[]; onSaved: () => void; onCancel: () => void;
}) {
  const [f, setF] = useState<GapRuleInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof GapRuleInput>(k: K, v: GapRuleInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const age = (v: string) => (v === '' ? null : Math.max(0, Math.min(130, parseInt(v, 10) || 0)));
  const label = (p: Program) => `${p.officeName} · ${p.name}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (id) await api.updateProgramGapRule(id, f);
      else await api.createProgramGapRule(f);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? fieldMessage(err) : 'Could not save the rule');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="field">
        <label className="field-label" htmlFor="gap-name">Name</label>
        <input id="gap-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={3} maxLength={120} autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="gap-kind">Type</label>
        <select id="gap-kind" className="select" value={f.kind} onChange={(e) => set('kind', e.target.value as GapRuleInput['kind'])}>
          <option value="missing">Not yet served: meets the conditions and is not in the program</option>
          <option value="conflict">Needs cleanup: meets the conditions and is still in the program</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="gap-target">Program to check</label>
        <select id="gap-target" className="select" value={f.targetModuleId} onChange={(e) => set('targetModuleId', e.target.value)} required>
          <option value="" disabled>Choose a program</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">Conditions: the person is in any of these programs (optional)</legend>
        <div className="ws-gap-programs">
          {programs.filter((p) => p.id !== f.targetModuleId).map((p) => (
            <Checkbox
              key={p.id}
              label={label(p)}
              checked={f.sourceModuleIds.includes(p.id)}
              onChange={(on) => set('sourceModuleIds', on ? [...f.sourceModuleIds, p.id] : f.sourceModuleIds.filter((x) => x !== p.id))}
            />
          ))}
        </div>
      </fieldset>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <div className="field">
          <label className="field-label" htmlFor="gap-min">Minimum age</label>
          <input id="gap-min" className="input" type="number" min={0} max={130} value={f.minAge ?? ''} onChange={(e) => set('minAge', age(e.target.value))} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="gap-max">Maximum age</label>
          <input id="gap-max" className="input" type="number" min={0} max={130} value={f.maxAge ?? ''} onChange={(e) => set('maxAge', age(e.target.value))} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="gap-sex">Sex</label>
          <select id="gap-sex" className="select" value={f.sex ?? ''} onChange={(e) => set('sex', (e.target.value || null) as GapRuleInput['sex'])}>
            <option value="">Any</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="gap-desc">Description (optional)</label>
        <textarea id="gap-desc" className="textarea" rows={2} maxLength={500} value={f.description ?? ''} onChange={(e) => set('description', e.target.value || null)} />
      </div>
      <Checkbox label="Active" checked={f.isActive} onChange={(on) => set('isActive', on)} />
      {error && <div className="field-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving...' : 'Save rule'}</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// The backend's zod refinements carry the useful message ("Add at least one
// condition..."); show that instead of the generic "Invalid rule".
function fieldMessage(err: ApiError): string {
  const details = err.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
  const first = details?.formErrors?.[0] ?? Object.values(details?.fieldErrors ?? {}).flat()[0];
  return first ?? err.message;
}
