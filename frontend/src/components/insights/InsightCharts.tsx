import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { sequentialBlueForValue, useChartTheme } from '@/lib/chartPalette';
import { mutedColor, seriesColor } from '@/lib/chartTheme';
import type { CityInsights, SankeyBucket } from '@/lib/api';

// Bar charts for the Insights page. Magnitude bars use the sequential ramp
// (same as Barangay ranking); categories in a stack use the chart palette.
// Every chart reads already-shaped data; the page owns filters and fetches.

const tick = { fontSize: 12, fill: 'var(--t-muted)' };
const tipStyle = { borderRadius: 'var(--r-md)', fontSize: 12 };
const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--t-muted)', textAlign: 'center', padding: '48px 0', margin: 0 }}>{children}</p>;
}

// "A + B + C + D + E" -> "A + B and 3 more": sample data can put one person
// in 18 programs, which would flood a label.
export function comboName(b: Pick<SankeyBucket, 'label' | 'moduleIds'>): string {
  const parts = b.label.split(' + ');
  if (b.moduleIds.length === 1) return `${b.label} only`;
  return parts.length > 3 ? `${parts.slice(0, 2).join(' + ')} and ${parts.length - 2} more` : b.label;
}

// Replaces the flow (Sankey) chart: the most common program combinations,
// ranked. Clicking a bar filters the page to that combination.
export function ProgramComboChart({ buckets, selected, onSelect }: {
  buckets: SankeyBucket[]; selected: string[] | null; onSelect: (moduleIds: string[]) => void;
}) {
  const theme = useChartTheme();
  const top = [...buckets].sort((a, b) => b.count - a.count).slice(0, 10).map((b) => ({ ...b, name: comboName(b) }));
  if (top.length === 0) return <Empty>No citizens are in any program yet.</Empty>;
  const key = (ids: string[]) => [...ids].sort().join(',');
  const sel = selected ? key(selected) : null;
  const counts = top.map((t) => t.count);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={top} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={tick} />
        <YAxis type="category" dataKey="name" width={170} tick={tick} tickFormatter={(v: string) => short(v)} />
        <Tooltip contentStyle={tipStyle} formatter={(v) => [v, 'Citizens']}
          labelFormatter={(_l, p) => (p?.[0]?.payload as SankeyBucket | undefined)?.label ?? ''} wrapperStyle={{ maxWidth: 320, whiteSpace: 'normal' }} />
        <Bar isAnimationActive={false} dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22} cursor="pointer"
          onClick={(e) => onSelect((e as unknown as SankeyBucket).moduleIds)}>
          {top.map((b) => (
            <Cell key={key(b.moduleIds)} fill={sequentialBlueForValue(b.count, Math.min(...counts), Math.max(...counts), theme)}
              stroke={sel === key(b.moduleIds) ? 'var(--primary)' : 'none'} strokeWidth={sel === key(b.moduleIds) ? 2 : 0} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Share of each barangay's residents who qualify for a program but are not
// in it (Program gaps "Not yet served" rules). Click = filter by barangay.
export function UnderservedChart({ data, selectedCode, onSelect }: {
  data: CityInsights['underserved']; selectedCode: string | null; onSelect: (code: string) => void;
}) {
  const theme = useChartTheme();
  const rows = data.barangays
    .filter((b) => b.notServed > 0 && b.code)
    .slice(0, 12)
    .map((b) => ({ code: b.code!, name: b.name ?? b.code!, share: Math.round((b.notServed / Math.max(1, b.residents)) * 100), notServed: b.notServed, residents: b.residents }));
  if (data.rules.length === 0) return <Empty>No &ldquo;Not yet served&rdquo; rules are active. Add them in Program gaps.</Empty>;
  if (rows.length === 0) return <Empty>Every resident who qualifies for a program is in it.</Empty>;
  const shares = rows.map((r) => r.share);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={tick} />
        <YAxis type="category" dataKey="name" width={130} tick={tick} tickFormatter={(v: string) => short(v, 20)} />
        <Tooltip contentStyle={tipStyle}
          formatter={(_v, _n, p) => {
            const r = p.payload as (typeof rows)[number];
            return [`${r.notServed} of ${r.residents} residents (${r.share}%)`, 'Not yet served'];
          }} />
        <Bar isAnimationActive={false} dataKey="share" radius={[0, 4, 4, 0]} maxBarSize={22} cursor="pointer"
          onClick={(e) => onSelect((e as unknown as { code: string }).code)}>
          {rows.map((r) => (
            <Cell key={r.code} fill={sequentialBlueForValue(r.share, Math.min(...shares), Math.max(...shares), theme)}
              stroke={selectedCode === r.code ? 'var(--primary)' : 'none'} strokeWidth={selectedCode === r.code ? 2 : 0} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const BUCKET_LABEL: Record<string, string> = { '0': 'No program', '1': '1 program', '2-3': '2 to 3', '4+': '4 or more' };

// Households by how many programs their members are in.
export function HouseholdReachChart({ data }: { data: CityInsights['reach'] }) {
  if (data.households === 0) return <Empty>No households in the registry yet.</Empty>;
  const rows = data.byPrograms.map((b) => ({ name: BUCKET_LABEL[b.bucket], households: b.households, none: b.bucket === '0' }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="name" tick={tick} />
        <YAxis allowDecimals={false} tick={tick} />
        <Tooltip contentStyle={tipStyle} formatter={(v) => [v, 'Households']} />
        <Bar isAnimationActive={false} dataKey="households" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {rows.map((r) => <Cell key={r.name} fill={r.none ? 'var(--danger)' : seriesColor(0)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// What each office must fix, as a share of its own records (one office's
// 20,000 records would otherwise flatten every other office into a sliver).
// The tooltip gives the counts.
export function DataQualityChart({ data }: { data: CityInsights['quality'] }) {
  const share = (n: number, of: number) => (of > 0 ? Math.min(100, Math.round((n / of) * 1000) / 10) : 0);
  const rows = data
    .map((q) => {
      const missing = q.noBarangay + q.noSex + q.noBirthdate;
      return {
        office: q.office, records: q.records,
        counts: { sample: q.sample, unlinked: q.unlinked, pending: q.pendingReview, missing },
        sample: share(q.sample, q.records), unlinked: share(q.unlinked, q.records), pending: share(q.pendingReview, q.records), missing: share(missing, q.records),
      };
    })
    .filter((r) => r.sample + r.unlinked + r.pending + r.missing > 0)
    .sort((a, b) => b.sample + b.unlinked + b.pending + b.missing - (a.sample + a.unlinked + a.pending + a.missing));
  type Row = (typeof rows)[number];
  if (rows.length === 0) return <Empty>No office has sample data, unlinked records, pending duplicates or missing details.</Empty>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={tick} />
        <YAxis type="category" dataKey="office" width={170} tick={tick} tickFormatter={(v: string) => short(v)} />
        <Tooltip contentStyle={tipStyle}
          formatter={(v, name, p) => {
            const r = p.payload as Row;
            const key = p.dataKey as keyof Row['counts'];
            return [`${r.counts[key].toLocaleString()} of ${r.records.toLocaleString()} records (${v}%)`, name];
          }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} stackId="q" dataKey="sample" name="Sample data" fill={mutedColor()} maxBarSize={22} />
        <Bar isAnimationActive={false} stackId="q" dataKey="unlinked" name="Person not linked to registry" fill={seriesColor(0)} maxBarSize={22} />
        <Bar isAnimationActive={false} stackId="q" dataKey="pending" name="Waiting duplicate review" fill={seriesColor(1)} maxBarSize={22} />
        <Bar isAnimationActive={false} stackId="q" dataKey="missing" name="Missing barangay, sex or birthdate" fill={seriesColor(2)} maxBarSize={22} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
