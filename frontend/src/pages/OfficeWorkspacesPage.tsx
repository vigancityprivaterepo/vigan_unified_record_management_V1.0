import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import type { AdminTab } from '@/components/shell/AdminSidebar';
import { compact, shortName } from '@/components/shell/OfficeSidebar';
import { api, ApiError, type Office } from '@/lib/api';
import { officeAppearance, officeColor } from '@/lib/officeTheme';

// Directory of every active office: one sidebar entry opens this page, and
// clicking an office opens its workspace (records + charts). Replaces a
// per-office list in the sidebar, which doesn't scale to 30-40 offices.
// Setting up offices (programs, fields, colors) stays under Manage > Offices.
export function OfficeWorkspacesPage({ onNavigate, initialQuery = '' }: { onNavigate?: (tab: AdminTab) => void; initialQuery?: string } = {}) {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(initialQuery);

  useEffect(() => {
    api
      .listOffices()
      .then(setOffices)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load offices'));
  }, []);

  const term = q.trim().toLowerCase();
  const shown = (offices ?? [])
    .filter((o) => o.isActive)
    .filter((o) => !term || [o.name, shortName(o.name), o.description ?? '', ...(o.modules ?? []).map((m) => m.name)].some((x) => x.toLowerCase().includes(term)))
    .sort((a, b) => shortName(a.name).localeCompare(shortName(b.name)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head">
        <div className="grow">
          <h1>Office workspaces</h1>
          <p>Open an office to see its records and charts.</p>
        </div>
      </div>

      <div className="ws-list-search">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an office or program" aria-label="Find an office or program" />
      </div>

      {error && (
        <div className="alert danger">
          <div className="body">{error}</div>
        </div>
      )}
      {offices === null && !error && <span className="spinner" />}
      {offices && shown.length === 0 && <div className="ws-card ws-card--pad" style={{ color: 'var(--t-muted)' }}>No office matches “{q}”.</div>}

      <div className="ws-ws-grid">
        {shown.map((o) => {
          const { hue, icon } = officeAppearance(o);
          return (
            <button key={o.id} type="button" className="ws-card ws-ws-card" onClick={() => onNavigate?.(`office:${o.id}`)}>
              <span className="ws-tile" style={{ background: officeColor(hue, 'acc') }}>
                <Icon name={icon} size={24} strokeWidth={1.8} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 17 }}>{shortName(o.name)}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--t-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {o.name}
                </span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--t-muted)', marginTop: 4 }}>
                  {compact(o.recordCount ?? 0)} records · {(o.modules ?? []).length} program{(o.modules ?? []).length === 1 ? '' : 's'}
                </span>
              </span>
              <Icon name="chevR" size={18} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
