import { useEffect, useId, useState } from 'react';
import { Checkbox } from '@/components/Checkbox';
import { MultiSelectDropdown } from '@/components/MultiSelectDropdown';
import { useToggleList } from '@/hooks/useToggleList';
import {
  api,
  type DashboardWidgetPayload,
  type Office,
  type OfficeFormField,
  type OfficeModule,
  type WidgetChartType,
} from '@/lib/api';

export type VisualizationFormValues = DashboardWidgetPayload;

// Shared by the "Create a visualization" form and the "Edit visualization"
// modal -- same fields, same recipe, just a different submit target
// (create vs. update) and starting values. Render with `key={widget.id}`
// when reusing this for edit so switching which widget is being edited
// remounts fresh state instead of carrying over the previous widget's.
export function VisualizationForm({
  offices,
  modulesByOffice,
  barangays,
  initialValues,
  submitLabel,
  submittingLabel,
  onSubmit,
  loadFields,
}: {
  offices: Office[];
  modulesByOffice: Record<string, OfficeModule[]>;
  barangays: Array<{ code: string; name: string }>;
  initialValues?: VisualizationFormValues;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: VisualizationFormValues) => Promise<void>;
  // Office staff read fields through their office's route, not admin's.
  loadFields?: (officeId: string, moduleId: string) => Promise<OfficeFormField[]>;
}) {
  // Unique per mount -- this form renders twice at once (the page's create
  // form + an open edit modal), so static ids like "widget-title" would
  // collide, breaking label association and making any id-based lookup
  // (including a browser's own autofill/tab order) target the wrong one.
  const formId = useId();
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const sourceModules = useToggleList();
  const [moduleFields, setModuleFields] = useState<OfficeFormField[]>([]);
  // 0-2 dimensions -- more than that and the composite label ("A / B / C")
  // gets unreadable fast, so the UI caps it here too, not just server-side.
  const groupBy = useToggleList(2);
  const [chartType, setChartType] = useState<WidgetChartType>(initialValues?.chartType ?? 'bar');
  // What each bar/slice adds up: record count, or the total of a number field.
  const [measure, setMeasure] = useState(initialValues?.measure ?? 'count');
  // Narrows the underlying query without being a chart axis -- '' means
  // "not filtered" for each, distinct from groupBy which always breaks
  // every value of a dimension out.
  const [filterBarangayCode, setFilterBarangayCode] = useState(initialValues?.filterBarangayCode ?? '');
  const [filterSex, setFilterSex] = useState(initialValues?.filterSex ?? '');
  const [filterMonth, setFilterMonth] = useState(initialValues?.filterMonth ?? '');
  // "Only records where <dropdown field> is <option>".
  const [filterFieldKey, setFilterFieldKey] = useState(initialValues?.filterFieldKey ?? '');
  const [filterFieldValue, setFilterFieldValue] = useState(initialValues?.filterFieldValue ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the toggle-list state once on mount from initialValues -- these
  // hooks can't take an initializer directly, and the parent already
  // guarantees a fresh mount per widget via `key`.
  useEffect(() => {
    if (initialValues?.sourceModuleIds) sourceModules.setSelected(initialValues.sourceModuleIds);
    if (initialValues?.groupBy) groupBy.setSelected(initialValues.groupBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group-by field options come straight from the selected module(s)' own
  // fields, not a hardcoded list -- the union across every selected source
  // (deduped by key, e.g. CSWD's Senior/PWD/Solo Parent all define
  // "has_id", so it appears once). A module that doesn't have the chosen
  // field just buckets its own rows under a blank label -- see the
  // backend's officeFormField lookup for why this is safe with a mixed
  // selection, not just an all-share-it one.
  useEffect(() => {
    if (sourceModules.selected.length === 0) {
      setModuleFields([]);
      groupBy.prune((d) => !d.startsWith('field:'));
      return;
    }
    const officeForModule = (moduleId: string) => offices.find((o) => (modulesByOffice[o.id] ?? []).some((m) => m.id === moduleId));

    Promise.all(
      sourceModules.selected.map((moduleId) => {
        const office = officeForModule(moduleId);
        return office ? (loadFields ?? api.listOfficeModuleFields)(office.id, moduleId).catch(() => []) : Promise.resolve([]);
      }),
    ).then((perModule) => {
      const byKey = new Map<string, OfficeFormField>();
      for (const fields of perModule) {
        for (const f of fields) {
          if (!byKey.has(f.key)) byKey.set(f.key, f);
        }
      }
      const union = [...byKey.values()];
      setModuleFields(union);
      setMeasure((m) => (m === 'count' || m === 'people' || union.some((f) => f.fieldType === 'NUMBER' && `sum:${f.key}` === m) ? m : 'count'));
      groupBy.prune((d) => !d.startsWith('field:') || union.some((f) => `field:${f.key}` === d));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceModules.selected]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        title,
        sourceModuleIds: sourceModules.selected,
        groupBy: chartType === 'number' ? undefined : groupBy.selected,
        chartType,
        measure,
        filterBarangayCode: filterBarangayCode || undefined,
        filterSex: filterSex || undefined,
        filterMonth: filterMonth || undefined,
        filterFieldKey: filterFieldKey && filterFieldValue ? filterFieldKey : undefined,
        filterFieldValue: filterFieldKey && filterFieldValue ? filterFieldValue : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save visualization');
    } finally {
      setSubmitting(false);
    }
  }

  const groupByOptions =
    chartType === 'number'
      ? []
      : [
          { value: 'barangay', label: 'Barangay' },
          { value: 'sex', label: 'Sex' },
          { value: 'month', label: 'Month registered' },
          { value: 'age_bracket', label: 'Age group (10-yr bands)' },
          { value: 'other_programs', label: 'Also enrolled in (same office)' },
          // FILE fields store a MinIO object key, not a value anyone would
          // want to see as a chart label, and MULTISELECT's value is an
          // array (grouping by one would bucket every unique combination of
          // picks, not by individual option) -- every other type (including
          // TEXT/NUMBER, e.g. "Location of Farm") is a reasonable, if
          // sometimes chatty, thing to group by.
          ...moduleFields
            .filter((f) => f.fieldType !== 'FILE' && f.fieldType !== 'MULTISELECT')
            .map((f) => ({ value: `field:${f.key}`, label: f.label })),
        ];

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      {error && (
        <div className="field-error" style={{ gridColumn: 'span 2' }}>
          {error}
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${formId}-title`}>
          Title
        </label>
        <input id={`${formId}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${formId}-chart-type`}>
          Chart type
        </label>
        <select
          id={`${formId}-chart-type`}
          className="select"
          value={chartType}
          onChange={(e) => setChartType(e.target.value as WidgetChartType)}
        >
          <option value="bar">Bar chart</option>
          <option value="line">Line chart</option>
          <option value="donut">Donut chart</option>
          <option value="number">Big number</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${formId}-measure`}>
          Measure
        </label>
        <select id={`${formId}-measure`} className="select" value={measure} onChange={(e) => setMeasure(e.target.value)}>
          <option value="count">Number of records</option>
          <option value="people">Number of people</option>
          {moduleFields
            .filter((f) => f.fieldType === 'NUMBER')
            .map((f) => (
              <option key={f.key} value={`sum:${f.key}`}>
                Total of {f.label}
              </option>
            ))}
        </select>
      </div>
      <div className="field span-2">
        <MultiSelectDropdown
          label="Data sources"
          summary={sourceModules.selected.length === 0 ? 'Select programs' : `${sourceModules.selected.length} selected`}
        >
          {offices.map((o) => {
            const mods = modulesByOffice[o.id] ?? [];
            if (mods.length === 0) return null;
            return (
              <div key={o.id}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-muted)', margin: '0 0 6px' }}>
                  {o.name}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px' }}>
                  {mods.map((m) => (
                    <Checkbox
                      key={m.id}
                      label={m.name}
                      checked={sourceModules.selected.includes(m.id)}
                      onChange={(checked) => sourceModules.toggle(m.id, checked)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </MultiSelectDropdown>
      </div>
      {chartType !== 'number' && (
        <div className="field span-2">
          <MultiSelectDropdown
            label={`Group by (${groupBy.selected.length}/2 selected)`}
            summary={groupBy.selected.length === 0 ? 'Not grouped' : groupByOptions.filter((o) => groupBy.selected.includes(o.value)).map((o) => o.label).join(', ')}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px' }}>
              {groupByOptions.map((opt) => {
                const checked = groupBy.selected.includes(opt.value);
                return (
                  <Checkbox
                    key={opt.value}
                    label={opt.label}
                    checked={checked}
                    disabled={!checked && groupBy.selected.length >= 2}
                    onChange={(c) => groupBy.toggle(opt.value, c)}
                  />
                );
              })}
            </div>
          </MultiSelectDropdown>
        </div>
      )}
      <div className="field span-2">
        <label className="field-label">Filters (optional)</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <select
            className="select"
            value={filterBarangayCode}
            onChange={(e) => setFilterBarangayCode(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">All barangays</option>
            {barangays.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          <select className="select" value={filterSex} onChange={(e) => setFilterSex(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">All sexes</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
          <input
            type="month"
            className="input"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            style={{ minWidth: 160 }}
          />
        </div>
        {moduleFields.some((f) => f.fieldType === 'SELECT') && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--t-muted)' }}>Only records where</span>
            <select
              className="select"
              value={filterFieldKey}
              onChange={(e) => {
                setFilterFieldKey(e.target.value);
                setFilterFieldValue('');
              }}
              style={{ minWidth: 180 }}
              aria-label="Filter field"
            >
              <option value="">(any field)</option>
              {moduleFields
                .filter((f) => f.fieldType === 'SELECT')
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
            {filterFieldKey && (
              <>
                <span style={{ fontSize: 13, color: 'var(--t-muted)' }}>is</span>
                <select
                  className="select"
                  value={filterFieldValue}
                  onChange={(e) => setFilterFieldValue(e.target.value)}
                  style={{ minWidth: 160 }}
                  aria-label="Filter value"
                >
                  <option value="">Pick a value</option>
                  {(moduleFields.find((f) => f.key === filterFieldKey)?.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
      </div>
      <div className="field span-2" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn--primary" disabled={submitting || sourceModules.selected.length === 0}>
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
