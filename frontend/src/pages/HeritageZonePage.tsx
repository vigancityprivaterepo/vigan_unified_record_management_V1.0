import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/Checkbox';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { api, ApiError, type HeritageSummary } from '@/lib/api';

// Heritage zone (admin): businesses, building and occupancy permits and
// zoning clearances inside the barangays the administrator marks as the
// heritage zone (backend services/heritageZone.ts). The zone's barangays are
// the city's to define, so the page starts empty until they are chosen.
export function HeritageZonePage() {
  const [data, setData] = useState<HeritageSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    setError(null);
    api.heritage().then(setData).catch((err) => { setData(null); setError(err); });
  }, [attempt]);
  const reload = () => setAttempt((n) => n + 1);
  const d = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>Heritage zone</h1>
          <p className="ws-kpi-sub" style={{ margin: '6px 0 0', maxWidth: 760 }}>
            Businesses, building and occupancy permits and zoning clearances inside the barangays you mark as the heritage zone. Building permits and zoning clearances also count when their own record says they are in the zone.
          </p>
        </div>
        {d && <button type="button" className="btn btn--ghost btn--lg" onClick={() => setChoosing(true)}>Choose barangays</button>}
      </div>
      {error != null && <LoadError what="the heritage zone" error={error} onRetry={reload} />}
      {error == null && !d && <span className="spinner" />}
      {d && (
        <>
          {d.barangays.length === 0 ? (
            <div className="ws-note hz-empty">
              <span>No barangays are marked as heritage zone yet, so businesses are not counted. Only permits and clearances whose own record says “in the heritage zone” appear below.</span>
              <button type="button" className="btn btn--primary" onClick={() => setChoosing(true)}>Choose barangays</button>
            </div>
          ) : (
            <p className="ws-kpi-sub" style={{ margin: 0 }}>Heritage-zone barangays: {d.barangays.map((b) => b.name).join(', ')}.</p>
          )}
          {d.usesSampleData && <p className="ws-note">Some of these records are sample data, so the counts below are not real yet.</p>}

          <div className="ws-kpis">
            <Kpi label="Businesses in the zone" value={d.businesses.total} sub={`${d.businesses.renewed.toLocaleString()} renewed for ${d.year}`} />
            <Kpi label={`Not renewed for ${d.year}`} value={d.businesses.notRenewed} sub={`last permit in ${d.year - 1}`} />
            <Kpi label={`Building permits, ${d.year}`} value={d.buildingPermits.thisYear} sub={`${d.buildingPermits.total.toLocaleString()} in all`} />
            <Kpi label="Zoning clearances" value={d.zoning.total} sub={`${d.occupancyPermits.total.toLocaleString()} occupancy permits`} />
          </div>

          <div className="br-grid">
            <List title="Businesses by barangay" empty={d.barangays.length ? 'No businesses recorded in these barangays.' : 'Choose the heritage-zone barangays to see businesses.'}
              rows={d.businesses.byBarangay.map((b) => ({ name: b.name, count: b.total, note: b.notRenewed ? `${b.notRenewed} not renewed` : undefined }))} />
            <List title="Building permits by barangay" empty="No building permits in the zone." rows={d.buildingPermits.byBarangay} />
            <List title="Building permits by use" empty="No building permits in the zone." rows={d.buildingPermits.byUse} />
            <List title="Zoning clearances by decision" empty="No zoning clearances in the zone." rows={d.zoning.byDecision} />
          </div>
        </>
      )}
      {choosing && d && (
        <Modal title="Heritage-zone barangays" eyebrow="Heritage zone" onClose={() => setChoosing(false)}>
          <ChooseBarangays all={d.allBarangays} chosen={d.barangays.map((b) => b.code)} onSaved={() => { setChoosing(false); reload(); }} onCancel={() => setChoosing(false)} />
        </Modal>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="ws-card ws-kpi">
      <span className="ws-kpi-label">{label}</span>
      <span className="ws-kpi-value">{value.toLocaleString()}</span>
      <span className="ws-kpi-sub">{sub}</span>
    </div>
  );
}

function List({ title, rows, empty }: { title: string; rows: Array<{ name: string; count: number; note?: string }>; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="ws-card ws-card--pad ws-stack-y">
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
      {rows.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>{empty}</p>}
      <div>
        {rows.map((r) => (
          <div key={r.name} className="br-row" style={{ cursor: 'default' }}>
            <span className="br-name">{r.name}{r.note && <span className="hz-note"> · {r.note}</span>}</span>
            <span className="ws-cov-bar" aria-hidden="true"><span style={{ width: `${(r.count / max) * 100}%` }} /></span>
            <strong>{r.count.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ChooseBarangays({ all, chosen, onSaved, onCancel }: {
  all: Array<{ code: string; name: string }>; chosen: string[]; onSaved: () => void; onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(chosen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.setHeritageBarangays(picked);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0 }}>Tick the barangays inside the heritage zone (core or buffer), as the city defines it. The change is recorded in the audit log.</p>
      <div className="hz-pick">
        {all.map((b) => (
          <Checkbox key={b.code} label={b.name} checked={picked.includes(b.code)}
            onChange={(on) => setPicked((p) => (on ? [...p, b.code] : p.filter((c) => c !== b.code)))} />
        ))}
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn btn--primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : `Save ${picked.length} ${picked.length === 1 ? 'barangay' : 'barangays'}`}</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
