import { useState } from 'react';
import { OfficeMark } from '@/components/OfficeMark';
import { AsyncState } from '@/components/AsyncState';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { OfficePicker } from '@/components/OfficePicker';
import { shortName } from '@/components/shell/OfficeSidebar';
import { VisualizationForm, type VisualizationFormValues } from '@/components/VisualizationForm';
import { WidgetCard } from '@/components/WidgetCard';
import { WidgetPreview } from '@/components/WidgetPreview';
import { useApiResource } from '@/hooks/useApiResource';
import { useVisualizationFormData } from '@/hooks/useVisualizationFormData';
import { ApiError, type DashboardWidget, type Office, type OfficeModule } from '@/lib/api';
import { adminWidgetApi, officeWidgetApi } from '@/lib/widgetApi';
import { officeAppearance } from '@/lib/officeTheme';

const DIMENSION_LABEL: Record<string, string> = {
  barangay: 'barangay',
  sex: 'sex',
  month: 'month',
  age_bracket: 'age group',
  other_programs: 'other programs',
};

const CHART_LABEL: Record<DashboardWidget['chartType'], string> = {
  bar: 'bar',
  line: 'line',
  donut: 'donut',
  number: 'total',
};

// "Senior citizens · by barangay · bar"
function describe(w: DashboardWidget): string {
  const dims = w.groupBy.map((d) => (d.startsWith('field:') ? d.slice(6).replace(/_/g, ' ') : DIMENSION_LABEL[d] ?? d));
  const filters = [w.filterBarangayName, w.filterSex, w.filterMonth, w.filterFieldValue].filter(Boolean);
  return [
    w.sourceModules.map((m) => m.name).join(', '),
    w.measure?.startsWith('sum:') ? `total of ${w.measure.slice(4).replace(/_/g, ' ')}` : w.measure === 'people' ? 'people' : null,
    dims.length ? `by ${dims.join(' and ')}` : null,
    filters.length ? `only ${filters.join(', ')}` : null,
    CHART_LABEL[w.chartType],
  ]
    .filter(Boolean)
    .join(' · ');
}

// Office names a widget draws from (a widget can chart several offices' programs).
function officesOf(w: DashboardWidget): string[] {
  return [...new Set(w.sourceModules.map((m) => m.officeName))];
}

const CROSS = '__cross__';

export function AllVisualizationsPage({ initialQuery }: { initialQuery?: string } = {}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <VisualizationBoard title="Visualizations" initialOffice={initialQuery} />
    </div>
  );
}

// Also embedded in an office's workspace (lockedOffice) as its "Charts" tab.
export function VisualizationBoard({
  title,
  initialOffice,
  lockedOffice,
  officeScope,
}: {
  title?: string;
  // Office name to preselect in the chips (from a link).
  initialOffice?: string;
  // Office name to show only -- no office chips (office workspace "Charts" tab).
  lockedOffice?: string;
  // Office staff's own board: their office's routes, programs and charts.
  officeScope?: { office: Office; modules: OfficeModule[] };
}) {
  const wapi = officeScope ? officeWidgetApi(officeScope.office.id) : adminWidgetApi;
  const { data: widgets, error, setError, reload } = useApiResource(wapi.list, 'Failed to load visualizations');
  const { offices, modulesByOffice, barangays } = useVisualizationFormData(officeScope);
  const canEdit = (w: DashboardWidget) => (officeScope ? w.editable === true : true);
  const ownerName = (w: DashboardWidget) => (w.officeId ? offices.find((o) => o.id === w.officeId)?.name : undefined);
  const [officeFilter, setOfficeFilter] = useState<string>(lockedOffice ?? initialOffice ?? 'all');
  const [dashboardOnly, setDashboardOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const officeByName = (name: string): Office | undefined => offices.find((o) => o.name === name);
  const hueOfOffice = (name: string) => officeAppearance(officeByName(name) ?? null).hue;
  const opened = widgets?.find((w) => w.id === openId) ?? null;

  async function handleCreate(values: VisualizationFormValues) {
    await wapi.create(values);
    setCreating(false);
    reload();
  }

  async function handleUpdate(values: VisualizationFormValues) {
    if (!editingWidget) return;
    await wapi.update(editingWidget.id, values);
    setEditingWidget(null);
    reload();
  }

  async function handleDelete(w: DashboardWidget) {
    if (!window.confirm(`Delete “${w.title}”? It will also disappear from the dashboard.`)) return;
    setError(null);
    try {
      await wapi.remove(w.id);
      setOpenId(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete visualization');
    }
  }

  async function handleToggleDashboard(w: DashboardWidget) {
    setError(null);
    setBusyId(w.id);
    try {
      await wapi.setOnDashboard(w.id, !w.showOnDashboard);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update the dashboard');
    } finally {
      setBusyId(null);
    }
  }

  const matchesOffice = (w: DashboardWidget) => {
    if (officeFilter === 'all') return true;
    if (officeFilter === CROSS) return officesOf(w).length > 1;
    return officesOf(w).includes(officeFilter);
  };
  const scoped = (widgets ?? []).filter(matchesOffice);
  const shown = scoped.filter((w) => !dashboardOnly || w.showOnDashboard);

  // Every active office (even with 0 charts, so gaps are visible), plus cross-office.
  const chips = widgets
    ? [
        { key: 'all', label: 'All', count: widgets.length, hue: null as number | null },
        { key: CROSS, label: 'Cross-office', count: widgets.filter((w) => officesOf(w).length > 1).length, hue: null as number | null },
        ...offices
          .filter((o) => o.isActive)
          .map((o) => ({
            key: o.name,
            label: shortName(o.name),
            count: widgets.filter((w) => officesOf(w).includes(o.name)).length,
            hue: officeAppearance(o).hue as number | null,
          })),
      ]
    : [];

  const toggleButton = (w: DashboardWidget) =>
    !canEdit(w) ? (
      <span className="ws-sample-tag" title="Made by the city administrator; view only">City chart</span>
    ) : w.showOnDashboard ? (
      <button
        type="button"
        className="ws-pill ws-pill--linked"
        style={{ border: 0, cursor: 'pointer', height: 34, padding: '0 12px', gap: 6 }}
        title={officeScope ? 'Unpin from your office Home' : 'Remove from dashboard'}
        disabled={busyId === w.id}
        onClick={() => handleToggleDashboard(w)}
      >
        <Icon name="check" size={14} /> {officeScope ? 'On Home' : 'On dashboard'}
      </button>
    ) : (
      <button type="button" className="ws-chip" style={{ height: 34 }} disabled={busyId === w.id} onClick={() => handleToggleDashboard(w)}>
        {officeScope ? 'Pin to Home' : 'Add to dashboard'}
      </button>
    );

  return (
    <>
      <div className="ws-page-head">
        <div className="grow">{title ? <h1>{title}</h1> : <h2 style={{ margin: 0, fontSize: 20 }}>Charts</h2>}</div>
        <button className="btn btn--primary btn--lg" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} strokeWidth={2.4} />
          Create visualization
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {!lockedOffice && !officeScope && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
            {/* Past 8 offices the per-office chips become one searchable dropdown. */}
            {(chips.length - 2 > 8 ? chips.slice(0, 2) : chips).map((c) => (
              <button key={c.key} type="button" className={`ws-chip${officeFilter === c.key ? ' is-on' : ''}`} onClick={() => setOfficeFilter(c.key)}>
                {c.label} · {c.count}
              </button>
            ))}
            {chips.length - 2 > 8 && (
              <OfficePicker
                options={chips.slice(2).sort((a, b) => a.label.localeCompare(b.label))}
                value={officeFilter === 'all' || officeFilter === CROSS ? null : officeFilter}
                onChange={setOfficeFilter}
              />
            )}
          </div>
        )}
        <div className="ws-seg" role="group" aria-label="Which charts to show">
          <button type="button" className={!dashboardOnly ? 'is-on' : ''} onClick={() => setDashboardOnly(false)}>
            All
          </button>
          <button type="button" className={dashboardOnly ? 'is-on' : ''} onClick={() => setDashboardOnly(true)}>
            {officeScope ? 'On Home' : 'On dashboard'}
          </button>
        </div>
      </div>

      <AsyncState error={error} loading={widgets === null} />
      {widgets && shown.length === 0 && (
        <div className="ws-card ws-card--pad" style={{ color: 'var(--t-muted)' }}>
          {scoped.length === 0 ? 'No charts for this office yet. Create one from its programs.' : 'None of these charts are on the dashboard.'}
        </div>
      )}

      {shown.length > 0 && (
        <div className="ws-viz-grid">
          {shown.map((w) => (
            <div key={w.id} className="ws-card ws-viz-card">
              <button type="button" className="ws-viz-open" onClick={() => setOpenId(w.id)} aria-label={`Open ${w.title}`}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>
                    {w.title}
                    {w.hasSampleData && <span className="ws-sample-tag">Sample data</span>}
                    {!officeScope && ownerName(w) && <span className="ws-sample-tag">By {shortName(ownerName(w)!)}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--t-muted)', marginTop: 2 }}>{describe(w)}</div>
                </div>
                <WidgetPreview widget={w} hue={hueOfOffice(w.sourceModules[0]?.officeName ?? '')} loadData={wapi.data} />
              </button>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {toggleButton(w)}
                <span style={{ flex: 1 }} />
                <span style={{ display: 'flex', gap: 4 }}>
                  {officesOf(w).map((name) => {
                    const a = officeAppearance(officeByName(name) ?? null);
                    return <OfficeMark key={name} name={name} hue={a.hue} icon={a.icon} />;
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {opened && (
        <Modal title={opened.title} eyebrow={officesOf(opened).map(shortName).join(' · ')} wide onClose={() => setOpenId(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 14, color: 'var(--t-muted)' }}>
              {describe(opened)}
              {opened.hasSampleData && <span className="ws-sample-tag">Sample data, not real records</span>}
            </div>
            <WidgetCard widget={opened} loadData={wapi.data} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {toggleButton(opened)}
              <span style={{ flex: 1 }} />
              {canEdit(opened) && (
                <>
                  <button
                    type="button"
                    className="btn btn--ghost ws-topbar-btn"
                    onClick={() => {
                      setEditingWidget(opened);
                      setOpenId(null);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(opened)}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      {creating && (
        <Modal title="Create visualization" eyebrow={lockedOffice ? shortName(lockedOffice) : 'Visualizations'} onClose={() => setCreating(false)}>
          <VisualizationForm
            key="create"
            offices={offices}
            modulesByOffice={modulesByOffice}
            barangays={barangays}
            submitLabel="Create visualization"
            submittingLabel="Creating..."
            onSubmit={handleCreate}
            loadFields={wapi.loadFields}
          />
        </Modal>
      )}

      {editingWidget && (
        <Modal title="Edit visualization" eyebrow={editingWidget.title} onClose={() => setEditingWidget(null)}>
          <VisualizationForm
            key={editingWidget.id}
            offices={offices}
            modulesByOffice={modulesByOffice}
            barangays={barangays}
            submitLabel="Save changes"
            submittingLabel="Saving..."
            loadFields={wapi.loadFields}
            initialValues={{
              title: editingWidget.title,
              sourceModuleIds: editingWidget.sourceModules.map((m) => m.id),
              groupBy: editingWidget.groupBy,
              chartType: editingWidget.chartType,
              measure: editingWidget.measure,
              filterFieldKey: editingWidget.filterFieldKey ?? undefined,
              filterFieldValue: editingWidget.filterFieldValue ?? undefined,
              filterBarangayCode: editingWidget.filterBarangayCode ?? undefined,
              filterSex: editingWidget.filterSex ?? undefined,
              filterMonth: editingWidget.filterMonth ?? undefined,
            }}
            onSubmit={handleUpdate}
          />
        </Modal>
      )}
    </>
  );
}
