import { useEffect, useState } from 'react';
import { api, type Office, type OfficeModule } from '@/lib/api';
import { DynamicOfficeRecordsPage } from '@/pages/DynamicOfficeRecordsPage';

// Admin's read-only look into one office. The shell sets --hue to this
// office's accent, so the page takes on that office's color while the admin
// rail stays dark -- "you're looking at Agriculture's data".
export function AdminOfficeWorkspacePage({ office }: { office: Office }) {
  const [modules, setModules] = useState<OfficeModule[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => { api.listOfficeModules(office.id).then(setModules).catch(() => setModules([])); }, [office.id]);

  if (!modules) return <span className="spinner" />;
  if (modules.length === 0) return <p style={{ color: 'var(--t-muted)' }}>This office has no modules yet.</p>;
  const current = modules[Math.min(active, modules.length - 1)];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {modules.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {modules.map((m, i) => (
            <button key={m.id} className={`ws-chip${i === active ? ' is-on' : ''}`} onClick={() => setActive(i)}>{m.name}</button>
          ))}
        </div>
      )}
      <DynamicOfficeRecordsPage key={current.id} officeId={office.id} officeName={office.name} module={current} readOnly />
    </div>
  );
}
