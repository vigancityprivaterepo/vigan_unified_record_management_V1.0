import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { RecordStatusPill, recordPersonName } from '@/components/RecordStatusPill';
import type { OfficeTab } from '@/components/shell/OfficeSidebar';
import { api, type Office, type OfficeModule, type OfficeRecordListItem } from '@/lib/api';
import { initials, moduleIcon } from '@/lib/officeTheme';
import { WidgetCard } from '@/components/WidgetCard';
import { LoadError } from '@/components/LoadError';
import type { DashboardWidget, TodoItem } from '@/lib/api';

type Recent = OfficeRecordListItem & { moduleName: string };

// Landing page for office staff: big, plain-language actions per module
// (the two things they do all day), then what their office added recently.
export function OfficeHomePage({ officeId, office: _office, modules, userName, counts, onGo }: {
  officeId: string;
  office: Office | null;
  modules: OfficeModule[];
  userName: string;
  counts: Record<string, number | undefined>;
  onGo: (tab: OfficeTab) => void;
}) {
  const [recent, setRecent] = useState<Recent[] | null>(null);
  // Charts this office pinned to its Home ("Pin to Home" on the Charts page).
  const [pinned, setPinned] = useState<DashboardWidget[] | null>(null);
  const [pinnedError, setPinnedError] = useState<unknown>(null);
  const [pinnedAttempt, setPinnedAttempt] = useState(0);
  useEffect(() => {
    setPinnedError(null);
    api
      .listOfficeWidgets(officeId)
      .then((ws) => setPinned(ws.filter((w) => w.editable && w.showOnDashboard)))
      .catch((err) => {
        setPinned(null);
        setPinnedError(err);
      });
  }, [officeId, pinnedAttempt]);

  // What needs attention, from Program gaps, Disaster lists, Business
  // renewals and duplicate review (counts only; the lists hold the names).
  const [todo, setTodo] = useState<TodoItem[] | null>(null);
  const [todoError, setTodoError] = useState<unknown>(null);
  const [todoAttempt, setTodoAttempt] = useState(0);
  useEffect(() => {
    setTodoError(null);
    api.officeTodo(officeId).then(setTodo).catch((err) => { setTodo(null); setTodoError(err); });
  }, [officeId, todoAttempt]);

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
        <h1 className="hero-title" style={{ fontSize: 26, margin: 0 }}>{greeting}, {userName.split(/\s+/)[0]}</h1>
      </div>

      {todoError != null && <LoadError what="your office's to-do list" error={todoError} onRetry={() => setTodoAttempt((n) => n + 1)} />}
      {todo && todo.length > 0 && (
        <section className="ws-card ws-card--pad ws-stack-y" aria-labelledby="todo-title">
          <h2 id="todo-title" style={{ margin: 0, fontSize: 17 }}>Needs your attention</h2>
          <div>
            {todo.map((t) => (
              <button key={t.key} type="button" className="oh-todo" onClick={() => onGo(t.go as OfficeTab)}>
                <strong>{t.count.toLocaleString()}</strong>
                <span><span className="oh-todo-label">{t.label}</span><span className="oh-todo-detail">{t.detail}</span></span>
                <Icon name="chevR" size={16} />
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="ws-action-grid">
        {modules.map((m) => (
          <div key={m.id} className="ws-card ws-action">
            <div className="ws-action-icon"><Icon name={moduleIcon(m)} size={24} strokeWidth={1.8} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{m.name}</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{counts[m.id]?.toLocaleString() ?? '…'}</div>
            </div>
            <button className="ws-icon-btn" title="Records" aria-label={`${m.name} records`} onClick={() => onGo(`records:${m.id}`)}><Icon name="list" size={20} strokeWidth={2} /></button>
            <button className="ws-icon-btn ws-icon-btn--primary" title="New registration" aria-label={`New ${m.name} registration`} onClick={() => onGo(`intake:${m.id}`)}><Icon name="plus" size={20} strokeWidth={2.6} /></button>
          </div>
        ))}
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, flex: 1 }}>Your office in charts</h2>
          <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ height: 34 }} onClick={() => onGo('charts')}>
            {pinned && pinned.length > 0 ? 'All charts' : 'Build a chart'}
          </button>
        </div>
        {pinnedError != null && <LoadError what="your office's charts" error={pinnedError} onRetry={() => setPinnedAttempt((n) => n + 1)} />}
        {pinned && pinned.length === 0 && (
          <div className="ws-card ws-card--pad" style={{ color: 'var(--t-muted)', fontSize: 14 }}>
            Tell your office's story with a chart, for example registrations per month or beneficiaries by barangay. Build one under
            Charts, then “Pin to Home” to show it here.
          </div>
        )}
        {pinned && pinned.length > 0 && (
          <div className="ws-home-charts">
            {pinned.map((w) => (
              <div key={w.id} className="ws-card" style={{ padding: 6 }}>
                <WidgetCard widget={w} loadData={(id) => api.getOfficeWidgetData(officeId, id)} />
              </div>
            ))}
          </div>
        )}
      </section>

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
