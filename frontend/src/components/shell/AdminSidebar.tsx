import logoUrl from '@/logo.png';
import type { Office } from '@/lib/api';
import { NavButton } from './OfficeSidebar';

export type AdminTab =
  | 'dashboard'
  | 'insights'
  | 'reports'
  | 'visualizations:list'
  | 'visualizations:create'
  | 'citizens'
  | 'households'
  | 'gaps'
  | 'assistance'
  | 'disaster'
  | 'renewals'
  | 'heritage'
  | 'privacy'
  | 'queue'
  | 'workspaces'
  | 'offices:list'
  | 'offices:create'
  | 'settings:staff'
  | 'settings:duplicate-matching'
  | `office:${string}`;

// One flat list, no section label -- the old Analytics/Records split. The
// old Dashboard ('reports') is now the Visualizations page's "On dashboard" view.
const MAIN: Array<{ key: AdminTab; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Overview', icon: 'chart' },
  { key: 'visualizations:list', label: 'Visualizations', icon: 'viz' },
  { key: 'insights', label: 'Insights', icon: 'insights' },
  { key: 'citizens', label: 'Citizens', icon: 'users' },
  { key: 'households', label: 'Households', icon: 'home' },
  { key: 'gaps', label: 'Program gaps', icon: 'target' },
  { key: 'assistance', label: 'Assistance', icon: 'heart' },
  { key: 'disaster', label: 'Disaster lists', icon: 'alert' },
  { key: 'renewals', label: 'Business renewals', icon: 'store' },
  { key: 'heritage', label: 'Heritage zone', icon: 'map' },
  { key: 'queue', label: 'Duplicate review', icon: 'queue' },
];
const MANAGE: Array<{ key: AdminTab; label: string; icon: string }> = [
  { key: 'offices:list', label: 'Offices', icon: 'building' },
  { key: 'settings:staff', label: 'Staff accounts', icon: 'staff' },
  { key: 'settings:duplicate-matching', label: 'Matching settings', icon: 'sliders' },
  { key: 'privacy', label: 'Privacy', icon: 'shield' },
];

export const ADMIN_TAB_LABELS: Record<string, string> = {
  ...Object.fromEntries([...MAIN, ...MANAGE].map((i) => [i.key, i.label])),
  reports: 'Visualizations',
  workspaces: 'Office workspaces',
  'visualizations:create': 'New visualization',
  'offices:create': 'Create office',
};

// The one place every office comes together -- a dark rail so it never
// reads as just another office workspace.
export function AdminSidebar({ activeTab, onSelect, offices, queueCount, footer, only }: {
  activeTab: AdminTab;
  onSelect: (tab: AdminTab) => void;
  offices: Office[];
  queueCount: number;
  footer: React.ReactNode;
  // A view-only account: just these pages, and no Offices or Manage sections.
  only?: AdminTab[];
}) {
  const isActive = (key: AdminTab) =>
    activeTab === key ||
    (key === 'visualizations:list' && (activeTab === 'visualizations:create' || activeTab === 'reports')) ||
    (key === 'offices:list' && activeTab === 'offices:create');

  return (
    <aside className="d-sidebar ws-rail--admin">
      <div className="brand">
        <div className="brand-logo"><img src={logoUrl} alt="City of Vigan seal" /></div>
        <div className="brand-text">
          <div className="brand-name">Vigan City Records</div>
          <div className="brand-tag">{only ? 'City view (view only)' : 'Administration console'}</div>
        </div>
      </div>

      <nav className="nav-section">
        {MAIN.filter((i) => !only || only.includes(i.key)).map((i) => (
          <NavButton key={i.key} active={isActive(i.key)} icon={i.icon} label={i.label} badge={i.key === 'queue' ? queueCount : undefined} onClick={() => onSelect(i.key)} />
        ))}

        {!only && <div className="nav-label">Offices</div>}
        {!only && <NavButton
          active={activeTab === 'workspaces' || activeTab.startsWith('office:')}
          icon="grid"
          label="Office workspaces"
          count={offices.filter((o) => o.isActive).length}
          onClick={() => onSelect('workspaces')}
        />}

        {!only && <div className="nav-label">Manage</div>}
        {!only && MANAGE.map((i) => <NavButton key={i.key} active={isActive(i.key)} icon={i.icon} label={i.label} onClick={() => onSelect(i.key)} />)}
      </nav>

      <div className="sidebar-footer">{footer}</div>
    </aside>
  );
}
