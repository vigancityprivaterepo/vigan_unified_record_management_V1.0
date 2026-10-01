import { useEffect, useState } from 'react';
import { LoadError } from '@/components/LoadError';
import { api, type Office, type OfficeModule } from '@/lib/api';
import { VisualizationBoard } from '@/pages/AllVisualizationsPage';
import { DynamicOfficeRecordsPage } from '@/pages/DynamicOfficeRecordsPage';

// Admin's look into one office: its records (read-only, one program at a
// time) and its charts. The shell sets --hue to this office's accent, so the
// page takes on that office's color while the admin rail stays dark.
export function AdminOfficeWorkspacePage({ office }: { office: Office }) {
  const [modules, setModules] = useState<OfficeModule[] | null>(null);
  const [active, setActive] = useState(0);
  const [view, setView] = useState<'records' | 'charts'>('records');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoadError(null);
    api.listOfficeModules(office.id).then(setModules).catch((err) => { setModules(null); setLoadError(err); });
  }, [office.id, attempt]);

  if (loadError != null) return <LoadError what={`${office.name}'s programs`} error={loadError} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!modules) return <span className="spinner" />;
  const current = modules[Math.min(active, modules.length - 1)];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="ws-seg" role="tablist" aria-label="Workspace view">
          <button type="button" role="tab" aria-selected={view === 'records'} className={view === 'records' ? 'is-on' : ''} onClick={() => setView('records')}>Records</button>
          <button type="button" role="tab" aria-selected={view === 'charts'} className={view === 'charts' ? 'is-on' : ''} onClick={() => setView('charts')}>Charts</button>
        </div>
        {view === 'records' && modules.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {modules.map((m, i) => (
              <button key={m.id} className={`ws-chip${i === active ? ' is-on' : ''}`} onClick={() => setActive(i)}>{m.name}</button>
            ))}
          </div>
        )}
      </div>
      {view === 'charts' && <VisualizationBoard lockedOffice={office.name} />}
      {view === 'records' && !current && <p style={{ color: 'var(--t-muted)' }}>This office has no programs yet.</p>}
      {view === 'records' && current && (
        <DynamicOfficeRecordsPage key={current.id} officeId={office.id} officeName={office.name} module={current} readOnly />
      )}
    </div>
  );
}
