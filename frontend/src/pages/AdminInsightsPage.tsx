import { useEffect, useState } from 'react';
import { AsyncState } from '@/components/AsyncState';
import { KpiCard, type KpiTile } from '@/components/KpiCard';
import { BarangayRankingChart } from '@/components/insights/BarangayRankingChart';
import { CategorySankeyChart } from '@/components/insights/CategorySankeyChart';
import { HouseholdTree } from '@/components/insights/HouseholdTree';
import { InsightsDrilldownTable } from '@/components/insights/InsightsDrilldownTable';
import { TrendChart } from '@/components/insights/TrendChart';
import {
  api,
  ApiError,
  type BarangayRankingRow,
  type HouseholdDetail,
  type InsightsCitizenRow,
  type InsightsSummary,
  type SankeyData,
  type TrendPoint,
} from '@/lib/api';

// Overview -> pattern -> detail: a headline KPI row, then relationship
// charts (Sankey, barangay ranking, trend) that cross-filter each other and
// the drill-down table/household panel below. Charts only ever receive
// already-shaped data as props; this page owns filter state and every
// fetch, one endpoint per chart, each refetching only on the filter fields
// it actually uses.
export type InsightsFilterState = {
  barangayCode: string | null;
  bucketModuleIds: string[] | null;
  monthFrom: string | null;
  monthTo: string | null;
};

const EMPTY_FILTERS: InsightsFilterState = { barangayCode: null, bucketModuleIds: null, monthFrom: null, monthTo: null };

function hasActiveFilter(f: InsightsFilterState): boolean {
  return f.barangayCode !== null || f.bucketModuleIds !== null || f.monthFrom !== null || f.monthTo !== null;
}

export function AdminInsightsPage() {
  const [filters, setFilters] = useState<InsightsFilterState>(EMPTY_FILTERS);
  // Tracked separately from `filters` -- "Reset filters" clears the
  // aggregate charts but leaves whichever household is open alone, since
  // browsing a specific household is a distinct action from filtering.
  const [selectedHeadKey, setSelectedHeadKey] = useState<string | null>(null);
  // Lifted out of SankeySection so HouseholdTree can color its category
  // tags with the exact same module-slot order as the Sankey -- "one color
  // per category, used everywhere" only holds if both charts share this.
  const [sankeyData, setSankeyData] = useState<SankeyData | null>(null);
  const orderedModuleIds = sankeyData?.modules.map((m) => m.id) ?? [];

  function toggleBarangay(code: string) {
    setFilters((f) => ({ ...f, barangayCode: f.barangayCode === code ? null : code }));
  }
  function toggleBucket(moduleIds: string[]) {
    const key = [...moduleIds].sort().join(',');
    setFilters((f) => ({ ...f, bucketModuleIds: f.bucketModuleIds && [...f.bucketModuleIds].sort().join(',') === key ? null : moduleIds }));
  }
  function toggleMonth(month: string) {
    setFilters((f) => ({ ...f, monthFrom: f.monthFrom === month ? null : month, monthTo: f.monthFrom === month ? null : month }));
  }
  function selectPerson(row: InsightsCitizenRow) {
    const headKey = row.personIsHead ? row.personKey : row.personParentKey;
    if (headKey) setSelectedHeadKey(headKey);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="hero">
        <div className="hero-text">
          <h1 className="hero-title">Insights</h1>
        </div>
      </div>

      {hasActiveFilter(filters) && (
        <div className="insights-filter-bar">
          {filters.barangayCode && <span className="insights-filter-chip">Barangay: {filters.barangayCode}</span>}
          {filters.bucketModuleIds && <span className="insights-filter-chip">Category combination selected</span>}
          {(filters.monthFrom || filters.monthTo) && <span className="insights-filter-chip">Month: {filters.monthFrom}</span>}
          <button className="btn btn--ghost btn--sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset filters
          </button>
        </div>
      )}

      <InsightsKpiRow barangayCode={filters.barangayCode} />

      <div className="insights-grid">
        <div className="card insights-chart-tall">
          <div className="card-head">
            <div className="card-title-wrap">
              <h3 className="card-title">Category overlap</h3>
            </div>
          </div>
          <SankeySection barangayCode={filters.barangayCode} onBucketClick={toggleBucket} onDataLoaded={setSankeyData} />
        </div>

        <div className="card insights-chart-tall">
          <div className="card-head">
            <div className="card-title-wrap">
              <h3 className="card-title">Barangay ranking</h3>
            </div>
          </div>
          <BarangaySection selectedCode={filters.barangayCode} onBarangayClick={toggleBarangay} />
        </div>
      </div>

      <div className="card insights-chart-tall">
        <div className="card-head">
          <div className="card-title-wrap">
            <h3 className="card-title">Registrations &amp; dedup merges over time</h3>
          </div>
        </div>
        <TrendSection onMonthClick={toggleMonth} />
      </div>

      <div className="insights-grid">
        <div className="card">
          <div className="card-head">
            <div className="card-title-wrap">
              <h3 className="card-title">Matching citizens</h3>
            </div>
          </div>
          <DrilldownSection filters={filters} onSelectPerson={selectPerson} />
        </div>

        <div className="card insights-chart-tall">
          <div className="card-head">
            <div className="card-title-wrap">
              <h3 className="card-title">Household</h3>
            </div>
          </div>
          <HouseholdSection headKey={selectedHeadKey} orderedModuleIds={orderedModuleIds} />
        </div>
      </div>
    </div>
  );
}

function InsightsKpiRow({ barangayCode }: { barangayCode: string | null }) {
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSummary(null);
    setError(null);
    api
      .insightsSummary({ barangayCode: barangayCode ?? undefined })
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load summary'));
  }, [barangayCode]);

  if (error || !summary) return <AsyncState error={error} loading={!summary} />;

  const tiles: KpiTile[] = [
    {
      label: 'Total citizens',
      value: summary.totalCitizens,
      className: 'c-primary',
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    },
    {
      label: 'Total households',
      value: summary.totalHouseholds,
      className: 'c-purple',
      icon: '<path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    },
    {
      label: 'Cross-office overlaps',
      value: summary.overlapCount,
      className: 'c-success',
      icon: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
    },
    {
      label: 'Data completeness',
      value: `${summary.completenessPct}%`,
      className: 'c-info',
      icon: '<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>',
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

function SankeySection({
  barangayCode,
  onBucketClick,
  onDataLoaded,
}: {
  barangayCode: string | null;
  onBucketClick: (moduleIds: string[]) => void;
  onDataLoaded: (data: SankeyData) => void;
}) {
  const [data, setData] = useState<SankeyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .insightsSankey({ barangayCode: barangayCode ?? undefined })
      .then((d) => {
        setData(d);
        onDataLoaded(d);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load category overlap'));
    // onDataLoaded is a page-level setState setter, stable across renders --
    // omitted from deps so this effect only re-runs on the filter it cares about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barangayCode]);

  if (error || !data) return <AsyncState error={error} loading={!data} />;
  return <CategorySankeyChart data={data} onBucketClick={onBucketClick} />;
}

function BarangaySection({ selectedCode, onBarangayClick }: { selectedCode: string | null; onBarangayClick: (code: string) => void }) {
  const [data, setData] = useState<BarangayRankingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .insightsBarangayRanking()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load barangay ranking'));
  }, []);

  if (error || !data) return <AsyncState error={error} loading={!data} />;
  return <BarangayRankingChart data={data} selectedCode={selectedCode} onBarangayClick={onBarangayClick} />;
}

function TrendSection({ onMonthClick }: { onMonthClick: (month: string) => void }) {
  const [data, setData] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .insightsTrend()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load trend'));
  }, []);

  if (error || !data) return <AsyncState error={error} loading={!data} />;
  return <TrendChart data={data} onMonthClick={onMonthClick} />;
}

function DrilldownSection({
  filters,
  onSelectPerson,
}: {
  filters: InsightsFilterState;
  onSelectPerson: (row: InsightsCitizenRow) => void;
}) {
  const [rows, setRows] = useState<InsightsCitizenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bucketParam = filters.bucketModuleIds ? [...filters.bucketModuleIds].sort().join(',') : undefined;

  useEffect(() => {
    setRows(null);
    setError(null);
    api
      .insightsCitizens({
        barangayCode: filters.barangayCode ?? undefined,
        from: filters.monthFrom ?? undefined,
        to: filters.monthTo ?? undefined,
        bucket: bucketParam,
      })
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load matching citizens'));
  }, [filters.barangayCode, filters.monthFrom, filters.monthTo, bucketParam]);

  if (error || !rows) return <AsyncState error={error} loading={!rows} />;
  return <InsightsDrilldownTable rows={rows} onSelectPerson={onSelectPerson} />;
}

function HouseholdSection({ headKey, orderedModuleIds }: { headKey: string | null; orderedModuleIds: string[] }) {
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!headKey) return;
    setDetail(null);
    setError(null);
    api
      .household(headKey)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load household'));
  }, [headKey]);

  if (!headKey) {
    return (
      <p style={{ fontSize: 13, color: 'var(--t-muted)', textAlign: 'center', padding: '48px 0' }}>
        Click a citizen below to see their household.
      </p>
    );
  }
  if (error || !detail) return <AsyncState error={error} loading={!detail} />;
  return <HouseholdTree detail={detail} orderedModuleIds={orderedModuleIds} />;
}
