import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { api, ApiError, type OfficeModule, type ProgramReport } from '@/lib/api';

// Summary report for one program and date range (backend
// services/programReport.ts): totals, by sex, age group, barangay and month.
// Counts only. Printable, and downloadable as CSV.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nice = (day: string) => new Date(`${day}T00:00`).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' });
const monthName = (ym: string) => new Date(`${ym}-01T00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

export function ReportDialog({ officeId, officeName, module, onClose }: {
  officeId: string; officeName: string; module: OfficeModule; onClose: () => void;
}) {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [report, setReport] = useState<ProgramReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!from || !to || from > to) return;
    setError(null);
    setReport(null);
    api.programReport(officeId, module.id, from, to).then(setReport).catch(setError);
  }, [officeId, module.id, from, to, attempt]);

  function preset(kind: 'month' | 'last' | 'quarter' | 'year') {
    const y = today.getFullYear(), m = today.getMonth();
    if (kind === 'month') { setFrom(iso(new Date(y, m, 1))); setTo(iso(today)); }
    if (kind === 'last') { setFrom(iso(new Date(y, m - 1, 1))); setTo(iso(new Date(y, m, 0))); }
    if (kind === 'quarter') { const q = Math.floor(m / 3) * 3; setFrom(iso(new Date(y, q, 1))); setTo(iso(today)); }
    if (kind === 'year') { setFrom(iso(new Date(y, 0, 1))); setTo(iso(today)); }
  }

  async function exportCsv() {
    setExportError(null);
    try {
      await api.exportProgramReport(officeId, module.id, from, to);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    }
  }

  return (
    <Modal title={`${module.name} report`} eyebrow={officeName} wide onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="rp-range">
          <label className="field-label" htmlFor="rp-from" style={{ margin: 0 }}>From</label>
          <input id="rp-from" className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <label className="field-label" htmlFor="rp-to" style={{ margin: 0 }}>To</label>
          <input id="rp-to" className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          <span className="rp-presets">
            <button type="button" className="ws-chip" onClick={() => preset('month')}>This month</button>
            <button type="button" className="ws-chip" onClick={() => preset('last')}>Last month</button>
            <button type="button" className="ws-chip" onClick={() => preset('quarter')}>This quarter</button>
            <button type="button" className="ws-chip" onClick={() => preset('year')}>This year</button>
          </span>
        </div>
        {from > to && <p className="field-error" style={{ margin: 0 }}>The start date must come before the end date.</p>}
        {error != null && <LoadError what="the report" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
        {error == null && !report && from <= to && <span className="spinner" />}
        {report && (
          <>
            {report.sample > 0 && <p className="ws-note">{report.sample} of these records are sample data, so this report is not real yet.</p>}
            <ReportBody report={report} />
            {exportError && <div className="alert danger"><div className="body">{exportError}</div></div>}
            <div className="form-actions">
              <button type="button" className="btn btn--primary" disabled={!report.total} onClick={() => setPrinting(true)}>Print report</button>
              <button type="button" className="btn btn--ghost" disabled={!report.total} onClick={exportCsv}><Icon name="download" size={16} /> Export CSV</button>
            </div>
            <p className="ws-kpi-sub" style={{ margin: 0 }}>
              Counts records registered in this program between the two dates. Age group is the age at the end of the period. A summary, not an official agency form.
            </p>
          </>
        )}
      </div>
      {printing && report && <PrintReport officeName={officeName} module={module} report={report} onDone={() => setPrinting(false)} />}
    </Modal>
  );
}

function Table({ title, rows, total }: { title: string; rows: Array<{ name: string; count: number }>; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <h3 className="in-sub" style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>{title}</h3>
      {rows.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>None.</p>}
      {rows.map((r) => (
        <div key={r.name} className="rp-row">
          <span>{r.name}</span>
          <span className="ws-cov-bar" aria-hidden="true"><span style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <strong>{r.count.toLocaleString()}</strong>
          <span className="rp-pct">{total ? Math.round((r.count / total) * 100) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

function ReportBody({ report: r }: { report: ProgramReport }) {
  return (
    <>
      <div className="rp-totals">
        <div><strong>{r.total.toLocaleString()}</strong><span>records</span></div>
        <div><strong>{r.people.toLocaleString()}</strong><span>registry citizens</span></div>
        <div><strong>{r.notLinked.toLocaleString()}</strong><span>not linked to the registry</span></div>
      </div>
      {r.total === 0 ? (
        <p style={{ margin: 0, color: 'var(--t-muted)' }}>No records were registered in this period.</p>
      ) : (
        <div className="rp-grid">
          <Table title="By sex" rows={r.bySex} total={r.total} />
          <Table title="By age group" rows={r.byAge} total={r.total} />
          <Table title="By barangay" rows={r.byBarangay} total={r.total} />
          <Table title="By month" rows={r.byMonth.map((m) => ({ name: monthName(m.month), count: m.count }))} total={r.total} />
        </div>
      )}
    </>
  );
}

// Printed report: the same numbers as plain tables, with the office,
// program and period. Shown only by @media print (see .dl-print).
function PrintReport({ officeName, module, report: r, onDone }: { officeName: string; module: OfficeModule; report: ProgramReport; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const after = () => done.current();
    window.addEventListener('afterprint', after);
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, []);
  const section = (title: string, rows: Array<{ name: string; count: number }>) => (
    <tbody>
      <tr className="dl-print-hh"><td colSpan={3}>{title}</td></tr>
      {rows.map((x) => <tr key={x.name}><td>{x.name}</td><td>{x.count}</td><td>{r.total ? Math.round((x.count / r.total) * 100) : 0}%</td></tr>)}
    </tbody>
  );
  return createPortal(
    <div className="dl-print">
      <div className="dl-print-head">
        <div>City Government of Vigan · {officeName}</div>
        <h1>{module.name}: summary report</h1>
        <div>{nice(r.from)} to {nice(r.to)} · printed {new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}</div>
        <div>{r.total} records · {r.people} registry citizens · {r.notLinked} not linked to the registry</div>
        {r.sample > 0 && <div className="dl-print-warn">{r.sample} of these records are sample data.</div>}
      </div>
      <table>
        <thead><tr><th>Item</th><th>Count</th><th>Share</th></tr></thead>
        {section('By sex', r.bySex)}
        {section('By age group (age at the end of the period)', r.byAge)}
        {section('By barangay', r.byBarangay)}
        {section('By month', r.byMonth.map((m) => ({ name: monthName(m.month), count: m.count })))}
      </table>
    </div>,
    document.body,
  );
}
