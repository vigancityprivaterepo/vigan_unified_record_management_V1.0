import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import type { AdminTab } from '@/components/shell/AdminSidebar';
import { api, type CityInsights } from '@/lib/api';

// Insights: four questions city officials ask, answered from every office's
// data together (backend services/cityInsights.ts). Counts only; each
// section links to the page that holds the names. The registry totals,
// program combinations and barangay ranking that used to be here are on
// the City overview; citizen and household lookups are on their own pages.
export function AdminInsightsPage({ onNavigate }: { onNavigate?: (tab: AdminTab, filter?: string) => void } = {}) {
  const [data, setData] = useState<CityInsights | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    api.cityInsights().then(setData).catch((err) => { setData(null); setError(err); });
  }, [attempt]);

  const sampleOffices = data?.quality.filter((q) => q.sample > 0).length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head">
        <div className="grow">
          <h1>Insights</h1>
          <p className="ws-kpi-sub" style={{ margin: '6px 0 0', maxWidth: 760 }}>
            Answers that need every office&apos;s records together. Worked out each time you open this page.
          </p>
        </div>
      </div>
      {error != null && <LoadError what="insights" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {error == null && !data && <span className="spinner" />}
      {data && (
        <>
          {sampleOffices > 0 && (
            <p className="ws-note">{sampleOffices} {sampleOffices === 1 ? 'office still has' : 'offices still have'} sample data mixed in (see the last section), so these answers are not final yet.</p>
          )}
          <UnderservedSection data={data.underserved} onOpen={onNavigate ? () => onNavigate('gaps') : undefined} />
          <ReachSection data={data.reach} />
          <PaceSection data={data.pace} onOpen={onNavigate ? () => onNavigate('gaps') : undefined} />
          <QualitySection data={data.quality} />
        </>
      )}
    </div>
  );
}

function Question({ n, title, answer, children, action }: { n: number; title: string; answer: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="ws-card ws-card--pad ws-stack-y in-q">
      <div className="ws-section-head">
        <div className="grow">
          <span className="in-q-n">Question {n}</span>
          <h2 style={{ margin: '2px 0 0', fontSize: 19 }}>{title}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 15 }}>{answer}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function UnderservedSection({ data, onOpen }: { data: CityInsights['underserved']; onOpen?: () => void }) {
  const ranked = data.barangays.filter((b) => b.notServed > 0);
  const top = ranked[0];
  const ruleName = (id: string) => data.rules.find((r) => r.id === id)?.name ?? 'a program';
  const answer = data.rules.length === 0
    ? 'No "Not yet served" rules are active, so there is nothing to measure. Add them in Program gaps.'
    : !top
      ? 'Every resident who qualifies for a program is in it. No barangay is underserved by the current rules.'
      : `${top.name ?? 'No barangay'} has the largest share: ${top.notServed} of ${top.residents} residents (${pct(top.notServed, top.residents)}%) qualify for a program but are not in it. ${ranked.length} ${ranked.length === 1 ? 'barangay has' : 'barangays have'} people not yet served.`;
  const max = Math.max(1, ...ranked.map((b) => pct(b.notServed, b.residents)));
  return (
    <Question n={1} title="Which barangays are underserved?" answer={answer}
      action={onOpen && <button type="button" className="btn btn--ghost" onClick={onOpen}>See the names in Program gaps</button>}>
      {ranked.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Barangay</th><th>Residents</th><th>Not yet served</th><th style={{ width: '28%' }}>Share of residents</th><th>Mostly</th></tr></thead>
            <tbody>
              {ranked.slice(0, 15).map((b) => {
                const reasons = Object.entries(b.byRule).sort((x, y) => y[1] - x[1]).slice(0, 2);
                return (
                  <tr key={b.code ?? 'none'}>
                    <td style={{ fontWeight: 600 }}>{b.name ?? 'No barangay'}</td>
                    <td>{b.residents.toLocaleString()}</td>
                    <td><strong>{b.notServed.toLocaleString()}</strong></td>
                    <td>
                      <span className="in-bar"><span className="ws-cov-bar" aria-hidden="true"><span style={{ width: `${(pct(b.notServed, b.residents) / max) * 100}%` }} /></span>{pct(b.notServed, b.residents)}%</span>
                    </td>
                    <td style={{ fontSize: 14 }}>{reasons.map(([id, n]) => `${ruleName(id)} (${n})`).join('; ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="ws-kpi-sub" style={{ margin: 0 }}>
        "Not yet served" means qualifying under an active Program gaps rule ({data.rules.map((r) => r.name).join('; ') || 'none'}) without being in that program. A person counts once even if several rules apply.
      </p>
    </Question>
  );
}

const BUCKET_LABEL: Record<string, string> = { '0': 'No program', '1': '1 program', '2-3': '2 to 3 programs', '4+': '4 or more programs' };

function ReachSection({ data }: { data: CityInsights['reach'] }) {
  const many = data.byPrograms.find((b) => b.bucket === '4+')?.households ?? 0;
  const none = data.byPrograms.find((b) => b.bucket === '0')?.households ?? 0;
  const answer = data.households === 0
    ? 'No households in the registry yet.'
    : `${pct(many, data.households)}% of households get help from 4 or more programs, ${pct(none, data.households)}% from none. ${data.vulnerableNone === 0 ? 'No household with a senior or a child under 5 is left without any program.' : `${data.vulnerableNone.toLocaleString()} ${data.vulnerableNone === 1 ? 'household' : 'households'} with a senior or a child under 5 ${data.vulnerableNone === 1 ? 'is' : 'are'} in no program at all.`}`;
  const max = Math.max(1, ...data.byPrograms.map((b) => b.households));
  return (
    <Question n={2} title="Who gets help, and who gets none?" answer={answer}>
      <div className="in-two">
        <div>
          <h3 className="in-sub">Households by number of programs</h3>
          {data.byPrograms.map((b) => (
            <div key={b.bucket} className="in-row">
              <span>{BUCKET_LABEL[b.bucket]}</span>
              <span className="ws-cov-bar" aria-hidden="true"><span style={{ width: `${(b.households / max) * 100}%` }} /></span>
              <strong>{b.households.toLocaleString()}</strong>
            </div>
          ))}
        </div>
        <div>
          <h3 className="in-sub">Households with a senior or child under 5, in no program</h3>
          {data.vulnerableNoneByBarangay.length === 0 && <p style={{ margin: 0, color: 'var(--t-muted)' }}>None.</p>}
          {data.vulnerableNoneByBarangay.map((b) => (
            <div key={b.name ?? 'none'} className="in-row in-row--plain"><span>{b.name ?? 'No barangay'}</span><strong>{b.households}</strong></div>
          ))}
        </div>
      </div>
      <p className="ws-kpi-sub" style={{ margin: 0 }}>Programs of every office count, for every member of the household. Deceased members are left out.</p>
    </Question>
  );
}

function PaceSection({ data, onOpen }: { data: CityInsights['pace']; onOpen?: () => void }) {
  const stuck = data.filter((p) => p.gap > 0 && p.months === null);
  const slow = data.filter((p) => p.months !== null && p.months > 12);
  const answer = data.length === 0
    ? 'No "Not yet served" rules are active.'
    : stuck.length + slow.length === 0
      ? 'Yes. At the current pace every gap closes within a year.'
      : `${stuck.length + slow.length} of ${data.length} ${data.length === 1 ? 'program is' : 'programs are'} not keeping up: ${[...stuck, ...slow].map((p) => p.program).join(', ')}.`;
  const verdict = (p: CityInsights['pace'][number]) =>
    p.gap === 0 ? 'Closed' : p.months === null ? 'Not moving: no new records in 3 months' : p.months <= 1 ? 'About a month' : `About ${p.months} months`;
  return (
    <Question n={3} title="Are programs keeping up?" answer={answer}
      action={onOpen && <button type="button" className="btn btn--ghost" onClick={onOpen}>Open Program gaps</button>}>
      {data.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Gap</th><th>Program</th><th>Not yet in it</th><th>New records a month</th><th>To close at this pace</th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.program}<div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{p.office}</div></td>
                  <td>{p.gap.toLocaleString()}</td>
                  <td>{p.perMonth.toLocaleString()}</td>
                  <td className={p.gap > 0 && (p.months === null || p.months > 12) ? 'in-warn' : ''}>{verdict(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ws-kpi-sub" style={{ margin: 0 }}>Pace = the program&apos;s new records per month over the last 3 full months. A rough guide: not every new record closes a gap.</p>
    </Question>
  );
}

function QualitySection({ data }: { data: CityInsights['quality'] }) {
  const issues = (q: CityInsights['quality'][number]) => q.sample + q.unlinked + q.pendingReview + q.noBarangay + q.noSex + q.noBirthdate;
  const withIssues = data.filter((q) => issues(q) > 0).sort((a, b) => issues(b) - issues(a));
  const answer = withIssues.length === 0
    ? 'Yes. No office has sample data, unlinked records, pending duplicates or missing details.'
    : `${withIssues.length} of ${data.length} offices have something to fix before their numbers can be trusted.`;
  const cell = (n: number) => (n > 0 ? <strong className="in-warn">{n.toLocaleString()}</strong> : <span className="in-ok">0</span>);
  return (
    <Question n={4} title="Is the data good enough to trust?" answer={answer}>
      {withIssues.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Office</th><th>Records</th><th>Sample data</th><th>Person not linked to registry</th><th>Waiting duplicate review</th><th>No barangay</th><th>No sex</th><th>No birthdate</th></tr>
            </thead>
            <tbody>
              {withIssues.map((q) => (
                <tr key={q.officeId}>
                  <td style={{ fontWeight: 600 }}>{q.office}</td>
                  <td>{q.records.toLocaleString()}</td>
                  <td>{cell(q.sample)}</td><td>{cell(q.unlinked)}</td><td>{cell(q.pendingReview)}</td>
                  <td>{cell(q.noBarangay)}</td><td>{cell(q.noSex)}</td><td>{cell(q.noBirthdate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="in-notes">
        <li><strong>Sample data</strong>: generated records; replace them by importing the office&apos;s real records.</li>
        <li><strong>Person not linked</strong>: records that name a person who is not matched to the City Citizen Registry, so they count in no cross-office answer.</li>
        <li><strong>Missing details</strong>: registry citizens with records in that office whose barangay, sex or birthdate is blank.</li>
      </ul>
      {data.length - withIssues.length > 0 && <p className="ws-kpi-sub" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={14} /> {data.length - withIssues.length} other offices have nothing to fix.</p>}
    </Question>
  );
}
