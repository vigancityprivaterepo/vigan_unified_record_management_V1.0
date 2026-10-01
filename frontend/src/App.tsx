import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { Modal } from '@/components/Modal';
import { HelpContent } from '@/components/shell/HelpContent';
import { TopbarSearch } from '@/components/shell/TopbarSearch';
import { AdminSidebar, ADMIN_TAB_LABELS, type AdminTab } from '@/components/shell/AdminSidebar';
import { OfficeSidebar, shortName, type OfficeTab } from '@/components/shell/OfficeSidebar';
import { api, type Office, type OfficeModule, type Session, type StaffRole } from '@/lib/api';
import { ADMIN_HUE, MONOCHROME, initials, officeAppearance, officeColor } from '@/lib/officeTheme';
import { AdminInsightsPage } from '@/pages/AdminInsightsPage';
import { AdminOfficeWorkspacePage } from '@/pages/AdminOfficeWorkspacePage';
import { AdminOverviewPage } from '@/pages/AdminOverviewPage';
import { AllOfficesPage } from '@/pages/AllOfficesPage';
import { AllVisualizationsPage, VisualizationBoard } from '@/pages/AllVisualizationsPage';
import { CitizensPage } from '@/pages/CitizensPage';
import { CreateOfficePage } from '@/pages/CreateOfficePage';
import { CreateVisualizationPage } from '@/pages/CreateVisualizationPage';
import { DuplicateMatchingPage } from '@/pages/DuplicateMatchingPage';
import { DuplicateReviewQueuePage } from '@/pages/DuplicateReviewQueuePage';
import { DynamicOfficeIntakePage } from '@/pages/DynamicOfficeIntakePage';
import { DynamicOfficeRecordsPage } from '@/pages/DynamicOfficeRecordsPage';
import { HouseholdsPage } from '@/pages/HouseholdsPage';
import { ProgramGapsPage } from '@/pages/ProgramGapsPage';
import { DisasterListsPage } from '@/pages/DisasterListsPage';
import { LoginPage } from '@/pages/LoginPage';
import { OfficeHomePage } from '@/pages/OfficeHomePage';
import { OfficeWorkspacesPage } from '@/pages/OfficeWorkspacesPage';
import { StaffAccountsPage } from '@/pages/StaffAccountsPage';

type Tab = AdminTab | OfficeTab;

// initialQuery: the top-bar search text, or a filter another page opened
// this one with (Offices -> Staff passes the office id).
type AdminPageProps = { onNavigate: (tab: AdminTab, filter?: string) => void; initialQuery?: string };

const PAGE_BY_ADMIN_TAB: Partial<Record<AdminTab, (props: AdminPageProps) => JSX.Element>> = {
  dashboard: AdminOverviewPage,
  insights: AdminInsightsPage,
  // The old Dashboard page is folded into Visualizations ("On dashboard" toggle).
  reports: AllVisualizationsPage,
  'visualizations:create': CreateVisualizationPage,
  'visualizations:list': AllVisualizationsPage,
  citizens: CitizensPage,
  households: HouseholdsPage,
  gaps: ProgramGapsPage,
  disaster: DisasterListsPage,
  queue: DuplicateReviewQueuePage,
  workspaces: OfficeWorkspacesPage,
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
  // Office staff: their office's programs failed to load (not "no programs").
  const [officeLoadError, setOfficeLoadError] = useState<unknown>(null);
  const [officeAttempt, setOfficeAttempt] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  // Small screens: the top-bar search collapses to a button that opens a
  // full-width search row under the top bar.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  // Query carried from the top-bar search into the list page it opened.
  const [searchSeed, setSearchSeed] = useState<{ tab: Tab; q: string; n: number } | null>(null);

  useEffect(() => { api.me().then(setSession).catch(() => setSession(null)); }, []);

  const isOfficeStaff = session !== 'loading' && session !== null && session.role === 'office_staff';
  const isAdmin = session !== 'loading' && session !== null && session.role === 'admin';

  useEffect(() => {
    if (!isOfficeStaff || !session.officeId) return;
    const officeId = session.officeId;
    setOfficeLoadError(null);
    api.getOffice(officeId).then(setOffice).catch(() => setOffice(null));
    api.getOfficeModules(officeId).then((ms) => {
      setModules(ms);
      // First page is enough -- we only need `total` for the sidebar counts.
      ms.forEach((m) => api.myOfficeModuleRecords(officeId, m.id).then((p) => setCounts((c) => ({ ...c, [m.id]: p.counts.all - p.counts.review }))).catch(() => undefined));
    }).catch((err) => { setModules(null); setOfficeLoadError(err); });
  }, [isOfficeStaff, session, officeAttempt]);

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
  const selectTab = (key: Tab) => { setTab(key); setSearchSeed(null); setDrawerOpen(false); window.scrollTo(0, 0); };
  const openSearch = (target: string, q: string) => {
    setMobileSearchOpen(false);
    selectTab(target as Tab);
    setSearchSeed((prev) => ({ tab: target as Tab, q, n: (prev?.n ?? 0) + 1 }));
  };
  const seedFor = (key: Tab) => (searchSeed?.tab === key ? searchSeed : null);
  const displayName = session.fullName || session.username;

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
    crumbs = [office ? shortName(office.name) : 'Office', ...(activeModule ? [activeModule.name] : []), kind === 'home' ? 'Home' : kind === 'charts' ? 'Charts' : kind === 'intake' ? 'New registration' : 'Records'];
    if (officeLoadError != null) pageElement = <LoadError what="your office's programs" error={officeLoadError} onRetry={() => setOfficeAttempt((n) => n + 1)} />;
    else if (!modules) pageElement = <div style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}><span className="spinner" /></div>;
    else if (kind === 'charts') {
      // Office staff's own charts: their office's programs only.
      pageElement = office ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <VisualizationBoard title="Charts" officeScope={{ office, modules }} />
        </div>
      ) : (
        <span className="spinner" />
      );
    } else if (kind === 'home' || !activeModule) pageElement = <OfficeHomePage officeId={officeId} office={office} modules={modules} userName={displayName} counts={counts} onGo={selectTab} />;
    else if (kind === 'records') {
      const seed = seedFor(activeTab);
      pageElement = <DynamicOfficeRecordsPage key={`${activeModule.id}:${seed?.n ?? 0}`} officeId={officeId} officeName={officeName} module={activeModule} initialQuery={seed?.q} onNew={() => selectTab(`intake:${activeModule.id}`)} />;
    }
    else pageElement = <DynamicOfficeIntakePage key={activeModule.id} officeId={officeId} officeName={officeName} module={activeModule} onViewRecords={() => selectTab(`records:${activeModule.id}`)} />;
  } else if (viewedOffice) {
    crumbs = ['Administration', 'Office workspaces', shortName(viewedOffice.name)];
    pageElement = <AdminOfficeWorkspacePage key={viewedOffice.id} office={viewedOffice} />;
  } else {
    const Page = PAGE_BY_ADMIN_TAB[activeTab as AdminTab];
    crumbs = ['Administration', ADMIN_TAB_LABELS[activeTab] ?? ''];
    const seed = seedFor(activeTab);
    pageElement = Page ? <Page key={seed?.n ?? 0} onNavigate={(t, f) => (f ? openSearch(t, f) : selectTab(t))} initialQuery={seed?.q} /> : <div />;
  }

  const userCard = (
    <div className="ws-usercard">
      <button
        type="button"
        className="workspace"
        aria-haspopup="menu"
        aria-expanded={profileOpen}
        onClick={(e) => { e.stopPropagation(); setProfileOpen((v) => !v); }}
      >
        <div className="workspace-avatar" style={{ background: MONOCHROME ? 'var(--primary)' : officeColor(hue, 'acc'), color: '#fff' }}>{initials(displayName)}</div>
        <div className="workspace-text">
          <div className="workspace-name">{displayName}</div>
          <div className="workspace-role">{session.position || ROLE_LABEL[session.role]} · {session.username}</div>
        </div>
      </button>
      {profileOpen && (
        <div className="ws-usercard-menu" role="menu">
          <button className="dd-menu-item danger" role="menuitem" onClick={() => { setProfileOpen(false); api.logout().finally(() => setSession(null)); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );

  const searchScope = isOfficeStaff && session.officeId
    ? { kind: 'office' as const, officeId: session.officeId, modules: modules ?? [] }
    : { kind: 'admin' as const };
  const searchPlaceholder = isOfficeStaff ? `Search ${office ? shortName(office.name) : 'office'} records...` : 'Search all citizens...';

  return (
    <div className={MONOCHROME ? 'shell ws-mono' : 'shell'} data-workspace={isOfficeStaff ? office?.slug ?? 'office' : viewedOffice ? viewedOffice.slug : 'admin'} style={{ '--hue': hue } as React.CSSProperties}>
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
            <TopbarSearch scope={searchScope} placeholder={searchPlaceholder} onOpen={openSearch} onRequestMobile={() => setMobileSearchOpen(true)} />
            <button
              type="button"
              className="btn btn--ghost ws-topbar-btn ws-search-toggle"
              aria-label={mobileSearchOpen ? 'Close search' : 'Search'}
              aria-expanded={mobileSearchOpen}
              onClick={() => setMobileSearchOpen((v) => !v)}
            >
              <Icon name={mobileSearchOpen ? 'x' : 'search'} size={18} />
            </button>
            <button className="btn btn--ghost ws-topbar-btn" aria-label="Help" onClick={() => setHelpOpen(true)}>
              <Icon name="help" size={16} />
              <span>Help</span>
            </button>
            <button className="btn btn--ghost ws-topbar-btn" onClick={toggleTheme} aria-label="Switch between light and dark mode">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </header>
        {mobileSearchOpen && (
          <div className="ws-search-mobile" onKeyDown={(e) => e.key === 'Escape' && setMobileSearchOpen(false)}>
            <TopbarSearch scope={searchScope} placeholder={searchPlaceholder} onOpen={openSearch} autoFocus />
          </div>
        )}

        <main className="content">{pageElement}</main>

        {helpOpen && (
          <Modal title="How this works" eyebrow={isOfficeStaff ? office?.name ?? 'Office' : 'Administration console'} onClose={() => setHelpOpen(false)}>
            <HelpContent role={session.role} />
          </Modal>
        )}

        <footer className="d-footer">
          <div>Vigan City &middot; Unified Central Record Management System</div>
          <div className="d-footer-meta"><span>{displayName}</span><span>{ROLE_LABEL[session.role]}</span></div>
        </footer>
      </div>
    </div>
  );
}
