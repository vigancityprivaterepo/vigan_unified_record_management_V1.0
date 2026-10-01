import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { AdminSidebar, ADMIN_TAB_LABELS, type AdminTab } from '@/components/shell/AdminSidebar';
import { OfficeSidebar, shortName, type OfficeTab } from '@/components/shell/OfficeSidebar';
import { api, type Office, type OfficeModule, type Session, type StaffRole } from '@/lib/api';
import { ADMIN_HUE, initials, officeAppearance } from '@/lib/officeTheme';
import { AdminDashboardPage } from '@/pages/AdminDashboardPage';
import { AdminInsightsPage } from '@/pages/AdminInsightsPage';
import { AdminOfficeWorkspacePage } from '@/pages/AdminOfficeWorkspacePage';
import { AdminOverviewPage } from '@/pages/AdminOverviewPage';
import { AllOfficesPage } from '@/pages/AllOfficesPage';
import { AllVisualizationsPage } from '@/pages/AllVisualizationsPage';
import { CitizensPage } from '@/pages/CitizensPage';
import { CreateOfficePage } from '@/pages/CreateOfficePage';
import { CreateVisualizationPage } from '@/pages/CreateVisualizationPage';
import { DuplicateMatchingPage } from '@/pages/DuplicateMatchingPage';
import { DuplicateReviewQueuePage } from '@/pages/DuplicateReviewQueuePage';
import { DynamicOfficeIntakePage } from '@/pages/DynamicOfficeIntakePage';
import { DynamicOfficeRecordsPage } from '@/pages/DynamicOfficeRecordsPage';
import { HouseholdsPage } from '@/pages/HouseholdsPage';
import { LoginPage } from '@/pages/LoginPage';
import { OfficeHomePage } from '@/pages/OfficeHomePage';
import { StaffAccountsPage } from '@/pages/StaffAccountsPage';

type Tab = AdminTab | OfficeTab;

const PAGE_BY_ADMIN_TAB: Partial<Record<AdminTab, () => JSX.Element>> = {
  dashboard: AdminOverviewPage,
  insights: AdminInsightsPage,
  reports: AdminDashboardPage,
  'visualizations:create': CreateVisualizationPage,
  'visualizations:list': AllVisualizationsPage,
  citizens: CitizensPage,
  households: HouseholdsPage,
  queue: DuplicateReviewQueuePage,
  'offices:create': CreateOfficePage,
  'offices:list': AllOfficesPage,
  'settings:staff': StaffAccountsPage,
  'settings:duplicate-matching': DuplicateMatchingPage,
};

const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Administrator', office_staff: 'Office staff' };

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => document.documentElement.getAttribute('data-theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('vigan-theme', theme); } catch { /* storage disabled */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const [session, setSession] = useState<Session | null | 'loading'>('loading');
  const [tab, setTab] = useState<Tab | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [office, setOffice] = useState<Office | null>(null);
  const [modules, setModules] = useState<OfficeModule[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number | undefined>>({});
  const [offices, setOffices] = useState<Office[]>([]);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => { api.me().then(setSession).catch(() => setSession(null)); }, []);

  const isOfficeStaff = session !== 'loading' && session !== null && session.role === 'office_staff';
  const isAdmin = session !== 'loading' && session !== null && session.role === 'admin';

  useEffect(() => {
    if (!isOfficeStaff || session === 'loading' || !session?.officeId) return;
    const officeId = session.officeId;
    api.getOffice(officeId).then(setOffice).catch(() => setOffice(null));
    api.getOfficeModules(officeId).then((ms) => {
      setModules(ms);
      // First page is enough -- we only need `total` for the sidebar counts.
      ms.forEach((m) => api.myOfficeModuleRecords(officeId, m.id).then((p) => setCounts((c) => ({ ...c, [m.id]: p.total }))).catch(() => undefined));
    }).catch(() => setModules([]));
  }, [isOfficeStaff, session]);

  useEffect(() => {
    if (!isAdmin) return;
    api.listOffices().then(setOffices).catch(() => setOffices([]));
    api.reviewQueue().then((q) => setQueueCount(q.length)).catch(() => setQueueCount(0));
  }, [isAdmin, tab]);

  useEffect(() => { document.body.classList.toggle('has-drawer-open', drawerOpen); }, [drawerOpen]);
  useEffect(() => {
    if (!profileOpen) return;
    const close = () => setProfileOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [profileOpen]);

  if (session === 'loading') {
    return <div className="content" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><span className="spinner" /></div>;
  }
  if (!session) return <LoginPage onLogin={setSession} />;

  const activeTab: Tab = tab ?? (isOfficeStaff ? 'home' : 'dashboard');
  const selectTab = (key: Tab) => { setTab(key); setDrawerOpen(false); window.scrollTo(0, 0); };

  // The one variable that makes each workspace look like its own place.
  const viewedOffice = isAdmin && activeTab.startsWith('office:') ? offices.find((o) => o.id === activeTab.slice(7)) ?? null : null;
  const hue = isOfficeStaff ? officeAppearance(office).hue : viewedOffice ? officeAppearance(viewedOffice).hue : ADMIN_HUE;

  let pageElement: JSX.Element = <div />;
  let crumbs: string[] = [];
  if (isOfficeStaff && session.officeId) {
    const officeId = session.officeId;
    const [kind, moduleId] = activeTab.split(':');
    const activeModule = modules?.find((m) => m.id === moduleId) ?? null;
    const officeName = office?.name ?? 'Office';
    crumbs = [office ? shortName(office.name) : 'Office', ...(activeModule ? [activeModule.name] : []), kind === 'home' ? 'Home' : kind === 'intake' ? 'New registration' : 'Records'];
    if (!modules) pageElement = <div style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}><span className="spinner" /></div>;
    else if (kind === 'home' || !activeModule) pageElement = <OfficeHomePage officeId={officeId} office={office} modules={modules} userName={session.username} counts={counts} onGo={selectTab} />;
    else if (kind === 'records') pageElement = <DynamicOfficeRecordsPage key={activeModule.id} officeId={officeId} officeName={officeName} module={activeModule} onNew={() => selectTab(`intake:${activeModule.id}`)} />;
    else pageElement = <DynamicOfficeIntakePage key={activeModule.id} officeId={officeId} officeName={officeName} module={activeModule} onViewRecords={() => selectTab(`records:${activeModule.id}`)} />;
  } else if (viewedOffice) {
    crumbs = ['Administration', 'Office workspaces', shortName(viewedOffice.name)];
    pageElement = <AdminOfficeWorkspacePage key={viewedOffice.id} office={viewedOffice} />;
  } else {
    const Page = PAGE_BY_ADMIN_TAB[activeTab as AdminTab];
    crumbs = ['Administration', ADMIN_TAB_LABELS[activeTab] ?? ''];
    pageElement = Page ? <Page /> : <div />;
  }

  const userCard = (
    <div className="workspace">
      <div className="workspace-avatar" style={{ background: `oklch(0.5 0.14 ${hue})`, color: '#fff' }}>{initials(session.username)}</div>
      <div className="workspace-text">
        <div className="workspace-name">{session.username}</div>
        <div className="workspace-role">{ROLE_LABEL[session.role]}</div>
      </div>
    </div>
  );

  return (
    <div className="shell" data-workspace={isOfficeStaff ? office?.slug ?? 'office' : viewedOffice ? viewedOffice.slug : 'admin'} style={{ '--hue': hue } as React.CSSProperties}>
      <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
      {isOfficeStaff ? (
        <OfficeSidebar office={office} modules={modules ?? []} activeTab={activeTab as OfficeTab} onSelect={selectTab} counts={counts} footer={userCard} />
      ) : (
        <AdminSidebar activeTab={activeTab as AdminTab} onSelect={selectTab} offices={offices} queueCount={queueCount} footer={userCard} />
      )}

      <div className="main">
        <header className="d-topbar">
          <div className="crumbs">
            <button className="hamburger" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i > 0 && <svg className="sep" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>}
                <span className={i === crumbs.length - 1 ? 'current' : undefined}>{c}</span>
              </span>
            ))}
          </div>
          <div className="topbar-actions">
            <button className="btn btn--ghost" onClick={toggleTheme} aria-label="Switch between light and dark mode">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <div className={`dd-wrap${profileOpen ? ' is-open' : ''}`}>
              <div className="avatar" tabIndex={0} role="button" aria-label="Account menu" onClick={(e) => { e.stopPropagation(); setProfileOpen((v) => !v); }}>
                {initials(session.username)}
              </div>
              <div className="dd-menu dd-profile" role="menu">
                <div className="dd-profile-head">
                  <div className="dd-profile-name">{session.username}</div>
                  <div className="dd-profile-email">{ROLE_LABEL[session.role]}</div>
                </div>
                <div className="dd-divider" />
                <button className="dd-menu-item danger" onClick={() => { setProfileOpen(false); api.logout().finally(() => setSession(null)); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="content">{pageElement}</main>

        <footer className="d-footer">
          <div>Vigan City &middot; Unified Central Record Management System</div>
          <div className="d-footer-meta"><span>{session.username}</span><span>{ROLE_LABEL[session.role]}</span></div>
        </footer>
      </div>
    </div>
  );
}
