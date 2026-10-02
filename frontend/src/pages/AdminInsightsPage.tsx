import { useEffect, useState } from 'react';
import { AsyncState } from '@/components/AsyncState';
import { KpiCard, type KpiTile } from '@/components/KpiCard';
import { BarangayRankingChart } from '@/components/insights/BarangayRankingChart';
import { HouseholdTree } from '@/components/insights/HouseholdTree';
import { comboName, DataQualityChart, HouseholdReachChart, ProgramComboChart, UnderservedChart } from '@/components/insights/InsightCharts';
import { Icon } from '@/components/Icon';
import { InsightsDrilldownTable } from '@/components/insights/InsightsDrilldownTable';
import { TrendChart } from '@/components/insights/TrendChart';
import {
  api,
  ApiError,
  type BarangayRankingRow,
  type CityInsights,
  type HouseholdDetail,
  type InsightsCitizenRow,
  type InsightsSummary,
  type SankeyData,
  type TrendPoint,
} from '@/lib/api';


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
 
  const [selectedHeadKey, setSelectedHeadKey] = useState<string | null>(null);
  
  const [sankeyData, setSankeyData] = useState<SankeyData | null>(null);
  const orderedModuleIds = sankeyData?.modules.map((m) => m.id) ?? [];
  
  const [questions, setQuestions] = useState<CityInsights | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [barangayNames, setBarangayNames] = useState<Record<string, string>>({});

  useEffect(() => {
    api.cityInsights().then(setQuestions).catch((err) => setQuestionsError(err instanceof ApiError ? err.message : 'Failed to load'));
    api.barangays().then((list) => setBarangayNames(Object.fromEntries(list.map((b) => [b.code, b.name])))).catch(() => undefined);
  }, []);

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

  const brgyName = filters.barangayCode ? barangayNames[filters.barangayCode] ?? filters.barangayCode : null;
  const comboLabel = filters.bucketModuleIds
    ? (() => {
        const key = [...filters.bucketModuleIds].sort().join(',');
        const b = sankeyData?.buckets.find((x) => [...x.moduleIds].sort().join(',') === key);
        return b ? comboName(b) : 'Selected combination';
      })()
    : null;
  const inBrgy = brgyName ? ` in ${brgyName}` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="hero">
        <div className="hero-text">
          <h1 className="hero-title">Insights</h1>
          <p className="ws-kpi-sub" style={{ margin: '6px 0 0' }}>Click a bar or a point to filter the page. Each chart says what it shows right now.</p>
        </div>
      </div>

      {hasActiveFilter(filters) && (
        <div className="insights-filter-bar" role="group" aria-label="Active filters">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Showing:</span>
          {brgyName && <FilterChip label={`Barangay: ${brgyName}`} onRemove={() => setFilters((f) => ({ ...f, barangayCode: null }))} />}
          {comboLabel && <FilterChip label={`Programs: ${comboLabel}`} onRemove={() => setFilters((f) => ({ ...f, bucketModuleIds: null }))} />}
          {filters.monthFrom && <FilterChip label={`Registered in ${monthLabel(filters.monthFrom)}`} onRemove={() => setFilters((f) => ({ ...f, monthFrom: null, monthTo: null }))} />}
          <button className="btn btn--ghost btn--sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear all</button>
        </div>
      )}

      <InsightsKpiRow barangayCode={filters.barangayCode} />

      <div className="insights-grid">
        <ChartCard title={`Most common program combinations${inBrgy}`}>
          <ComboSection barangayCode={filters.barangayCode} selected={filters.bucketModuleIds} onBucketClick={toggleBucket} onDataLoaded={setSankeyData} />
        </ChartCard>
        <ChartCard title="Barangay ranking">
          <BarangaySection selectedCode={filters.barangayCode} onBarangayClick={toggleBarangay} />
        </ChartCard>
      </div>

      <div className="insights-grid">
        <ChartCard title="Underserved barangays">
          <QuestionChart error={questionsError} data={questions} takeaway={(q) => underservedTakeaway(q.underserved)}
            render={(q) => <UnderservedChart data={q.underserved} selectedCode={filters.barangayCode} onSelect={toggleBarangay} />} />
        </ChartCard>
        <ChartCard title="Households by number of programs">
          <QuestionChart error={questionsError} data={questions} takeaway={(q) => reachTakeaway(q.reach)}
            render={(q) => <HouseholdReachChart data={q.reach} />} />
        </ChartCard>
      </div>

      <ChartCard title="Registrations & dedup merges, last 24 months">
        <TrendSection selectedMonth={filters.monthFrom} onMonthClick={toggleMonth} />
      </ChartCard>

      <ChartCard title="What each office must fix before its numbers can be trusted">
        <QuestionChart error={questionsError} data={questions} takeaway={(q) => qualityTakeaway(q.quality)}
          render={(q) => <DataQualityChart data={q.quality} />} />
      </ChartCard>

      <div className="insights-grid">
        <div className="card">
          <div className="card-head">
            <div className="card-title-wrap">
              <h3 className="card-title">Matching citizens{inBrgy}</h3>
            </div>
          </div>
          <DrilldownSection filters={filters} onSelectPerson={selectPerson} />
        </div>

        <ChartCard title="Household">
          <HouseholdSection headKey={selectedHeadKey} orderedModuleIds={orderedModuleIds} />
        </ChartCard>
      </div>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="insights-filter-chip">
      {label}
      <button type="button" className="ins-chip-x" aria-label={`Remove filter: ${label}`} onClick={onRemove}><Icon name="x" size={13} /></button>
    </span>
  );
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym: string): string {
  return new Date(`${ym.slice(0, 7)}-01T00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

// A chart card: title, then the section's takeaway line and chart.
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card insights-chart-tall">
      <div className="card-head">
        <div className="card-title-wrap">
          <h3 className="card-title">{title}</h3>
        </div>
      </div>
      {children}
    </div>
  );
}

function ChartBody({ takeaway, children }: { takeaway: string | null; children: React.ReactNode }) {
  return (
    <div className="ins-body">
      {takeaway && <p className="ins-takeaway">{takeaway}</p>}
      <div className="ins-chart">{children}</div>
    </div>
  );
}

function QuestionChart({ error, data, takeaway, render }: {
  error: string | null; data: CityInsights | null; takeaway: (q: CityInsights) => string; render: (q: CityInsights) => React.ReactNode;
}) {
  if (error || !data) return <AsyncState error={error} loading={!data} />;
  return <ChartBody takeaway={takeaway(data)}>{render(data)}</ChartBody>;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function underservedTakeaway(u: CityInsights['underserved']): string {
  const ranked = u.barangays.filter((b) => b.notServed > 0);
  if (u.rules.length === 0) return 'No "Not yet served" rules are active in Program gaps.';
  if (!ranked.length) return 'No barangay has residents who qualify for a program but are not in it.';
  const t = ranked[0]!;
  return `${t.name ?? 'No barangay'} is the most underserved: ${t.notServed} of ${t.residents} residents (${pct(t.notServed, t.residents)}%) qualify for a program but are not in it. ${ranked.length} barangays have people not yet served.`;
}

function reachTakeaway(r: CityInsights['reach']): string {
  if (r.households === 0) return 'No households in the registry yet.';
  const many = r.byPrograms.find((b) => b.bucket === '4+')?.households ?? 0;
  const none = r.byPrograms.find((b) => b.bucket === '0')?.households ?? 0;
  return `${pct(many, r.households)}% of ${r.households} households are in 4 or more programs, ${pct(none, r.households)}% in none. ${r.vulnerableNone ? `${r.vulnerableNone} with a senior or a child under 5 get no help at all.` : 'Every household with a senior or a child under 5 is in at least one program.'}`;
}

function qualityTakeaway(q: CityInsights['quality']): string {
  const bad = q.filter((x) => x.sample + x.unlinked + x.pendingReview + x.noBarangay + x.noSex + x.noBirthdate > 0);
  if (!bad.length) return 'Every office\u2019s data is ready: no sample data, unlinked records, pending duplicates or missing details.';
  const sample = q.filter((x) => x.sample > 0).length;
  const unlinked = [...q].sort((a, b) => b.unlinked - a.unlinked)[0];
  return `${bad.length} of ${q.length} offices have something to fix. ${sample} still have sample data${unlinked && unlinked.unlinked > 0 ? `; ${unlinked.office} has ${unlinked.unlinked.toLocaleString()} records naming a person not linked to the registry` : ''}.`;
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

function ComboSection({
  barangayCode,
  selected,
  onBucketClick,
  onDataLoaded,
}: {
  barangayCode: string | null;
  selected: string[] | null;
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
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load program combinations'));
    // onDataLoaded is a stable page-level setter; re-run only when the barangay changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barangayCode]);

  if (error || !data) return <AsyncState error={error} loading={!data} />;
  const multi = data.buckets.filter((b) => b.moduleIds.length >= 2);
  const top = [...multi].sort((x, y) => y.count - x.count)[0];
  const people = data.buckets.reduce((n, b) => n + b.count, 0);
  const inMulti = multi.reduce((n, b) => n + b.count, 0);
  const takeaway = people === 0
    ? null
    : `${inMulti} of ${people} citizens (${pct(inMulti, people)}%) are in 2 or more programs.${top ? ` Most common: ${comboName(top)} (${top.count}).` : ''}`;
  return (
    <ChartBody takeaway={takeaway}>
      <ProgramComboChart buckets={data.buckets} selected={selected} onSelect={onBucketClick} />
    </ChartBody>
  );
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
  const total = data.reduce((n, r) => n + r.count, 0);
  const top3 = data.slice(0, 3).reduce((n, r) => n + r.count, 0);
  const takeaway = data[0] ? `${data[0].name} has the most citizens in the registry (${data[0].count}). The top 3 barangays hold ${pct(top3, total)}% of everyone.` : null;
  return (
    <ChartBody takeaway={takeaway}>
      <BarangayRankingChart data={data} selectedCode={selectedCode} onBarangayClick={onBarangayClick} />
    </ChartBody>
  );
}

function TrendSection({ selectedMonth: _selectedMonth, onMonthClick }: { selectedMonth: string | null; onMonthClick: (month: string) => void }) {
  const [data, setData] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      
      .insightsTrend({ from: monthsAgo(23) })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load trend'));
  }, []);

  if (error || !data) return <AsyncState error={error} loading={!data} />;
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const change = last && prev && prev.registrations > 0 ? Math.round(((last.registrations - prev.registrations) / prev.registrations) * 100) : null;
  const merges = data.reduce((n, p) => n + p.merges, 0);
  const takeaway = last
    ? `${last.registrations} new registrations in ${monthLabel(last.month)}${change === null ? '' : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% from the month before`}. ${merges} duplicate ${merges === 1 ? 'record was' : 'records were'} merged in this period.`
    : null;
  return (
    <ChartBody takeaway={takeaway}>
      <TrendChart data={data} onMonthClick={onMonthClick} />
    </ChartBody>
  );
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
  return (
    <>
      <p className="ins-takeaway" style={{ padding: '0 20px' }}>{rows.length} {rows.length === 1 ? 'citizen matches' : 'citizens match'} the filters. Click one to see their household.</p>
      <div className="ins-scroll"><InsightsDrilldownTable rows={rows} onSelectPerson={onSelectPerson} /></div>
    </>
  );
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
