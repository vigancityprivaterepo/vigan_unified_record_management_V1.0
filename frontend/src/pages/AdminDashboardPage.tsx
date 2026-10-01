import { useEffect, useState } from 'react';
import { KpiCard, type KpiTile } from '@/components/KpiCard';
import { WidgetCard } from '@/components/WidgetCard';
import { api, ApiError, type DashboardSummary, type DashboardWidget } from '@/lib/api';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Generic "fetch on mount, track loading/error" hook. Both sections on this
// page (and likely other admin pages) follow the exact same
// fetch -> setData / catch -> setError shape, so it's pulled out once here.
function useApiResource<T>(fetchFn: () => Promise<T>, fallbackMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFn()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : fallbackMessage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, error };
}

// Shared loading/error rendering so each section doesn't re-implement the
// same two-line if/if block. Renders nothing once data has arrived.
function AsyncState({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <div className="field-error">{error}</div>;
  if (loading) return <span className="spinner" />;
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AdminDashboardPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="hero">
        <div className="hero-text">
          <h1 className="hero-title">Dashboard</h1>
        </div>
      </div>

      <SummaryKpis />
      <SavedVisualizations />
    </div>
  );
}

// Org-wide numbers at a glance, before admin digs into any chart below --
// total non-archived citizens, active offices/modules, and this month's
// intake volume across every office.
function SummaryKpis() {
  const { data: summary, error } = useApiResource<DashboardSummary>(
    api.dashboardSummary,
    'Failed to load summary'
  );

  if (error || !summary) return <AsyncState error={error} loading={!summary} />;

  const tiles: KpiTile[] = [
    {
      label: 'Citizens on file',
      value: summary.citizenCount,
      className: 'c-primary',
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    },
    {
      label: 'Active offices',
      value: summary.officeCount,
      className: 'c-purple',
      icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    },
    {
      label: 'Modules configured',
      value: summary.moduleCount,
      className: 'c-success',
      icon: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    },
    {
      label: 'Records this month',
      value: summary.recordsThisMonth,
      className: 'c-danger',
      icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    },
  ];

  return (
    <div className="kpi-grid">
      {tiles.map((t) => (
        <KpiCard key={t.label} {...t} />
      ))}
    </div>
  );
}

// Read-only display of whatever's been built on the Visualizations pages --
// no builder form or delete here, that's separate, dedicated modules (see
// CreateVisualizationPage.tsx / AllVisualizationsPage.tsx) so the Dashboard
// stays a viewing surface.
function SavedVisualizations() {
  const { data: widgets, error } = useApiResource<DashboardWidget[]>(
    api.listDashboardWidgets,
    'Failed to load visualizations'
  );

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title-wrap">
          <h3 className="card-title">Visualizations</h3>
          <p className="card-desc">Built from the Visualizations page -- consolidated data from any office.</p>
        </div>
      </div>

      <AsyncState error={error} loading={widgets === null} />

      {widgets?.filter((w) => w.showOnDashboard).length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--t-muted)' }}>
          Nothing on the dashboard yet -- use “Add to dashboard” on the Visualizations page.
        </p>
      )}

      {widgets && widgets.some((w) => w.showOnDashboard) && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {widgets.filter((w) => w.showOnDashboard).map((w) => (
            <div className="col-6" key={w.id}>
              <WidgetCard widget={w} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}