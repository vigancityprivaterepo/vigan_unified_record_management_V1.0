import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { RecordStatusPill, recordPersonName } from '@/components/RecordStatusPill';
import type { OfficeTab } from '@/components/shell/OfficeSidebar';
import { api, type Office, type OfficeModule, type OfficeRecordListItem } from '@/lib/api';
import { initials, moduleIcon } from '@/lib/officeTheme';

type Recent = OfficeRecordListItem & { moduleName: string };

// Landing page for office staff: big, plain-language actions per module
// (the two things they do all day), then what their office added recently.
export function OfficeHomePage({ officeId, office, modules, userName, counts, onGo }: {
  officeId: string;
  office: Office | null;
  modules: OfficeModule[];
  userName: string;
  counts: Record<string, number | undefined>;
  onGo: (tab: OfficeTab) => void;
}) {
  const [recent, setRecent] = useState<Recent[] | null>(null);

  useEffect(() => {
    Promise.all(
      modules.map((m) => api.myOfficeModuleRecords(officeId, m.id).then((p) => p.items.slice(0, 4).map((r) => ({ ...r, moduleName: m.name }))).catch(() => [] as Recent[])),
    ).then((lists) => setRecent(lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6)));
  }, [officeId, modules]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const multi = modules.length > 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <div className="ws-eyebrow" style={{ marginBottom: 10 }}>{today}</div>
        <h1 className="hero-title" style={{ fontSize: 34, margin: 0 }}>{greeting}, {userName}</h1>
      </div>

      <div className="ws-action-grid">
        {modules.map((m) => (
          <div key={m.id} className="ws-card ws-action">
            <div className="ws-action-icon"><Icon name={moduleIcon(m)} size={24} strokeWidth={1.8} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{m.name}</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{counts[m.id]?.toLocaleString() ?? '—'}</div>
            </div>
            <button className="ws-icon-btn" title="Records" aria-label={`${m.name} records`} onClick={() => onGo(`records:${m.id}`)}><Icon name="list" size={20} strokeWidth={2} /></button>
            <button className="ws-icon-btn ws-icon-btn--primary" title="New registration" aria-label={`New ${m.name} registration`} onClick={() => onGo(`intake:${m.id}`)}><Icon name="plus" size={20} strokeWidth={2.6} /></button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <section className="ws-card" style={{ flex: '2 1 520px', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px' }}><h2 style={{ margin: 0, fontSize: 17 }}>Recently added by your office</h2></div>
          {recent === null && <div style={{ padding: 22 }}><span className="spinner" /></div>}
          {recent?.length === 0 && <div className="ws-row" style={{ color: 'var(--t-muted)' }}>Nothing yet. Records you register will show up here.</div>}
          {recent?.map((r) => {
            const name = recordPersonName(r);
            return (
              <div key={r.id} className="ws-row">
                <div className="ws-avatar">{initials(name)}</div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>
                    {[multi ? r.moduleName : null, r.citizen?.barangay?.name, new Date(r.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <RecordStatusPill record={r} />
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
