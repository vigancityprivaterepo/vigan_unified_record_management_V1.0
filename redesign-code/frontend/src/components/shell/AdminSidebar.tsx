import logoUrl from '@/logo.png';
import type { Office } from '@/lib/api';
import { officeAppearance } from '@/lib/officeTheme';
import { NavButton, shortName } from './OfficeSidebar';

export type AdminTab =
  | 'dashboard'
  | 'insights'
  | 'reports'
  | 'visualizations:list'
  | 'visualizations:create'
  | 'citizens'
  | 'households'
  | 'queue'
  | 'offices:list'
  | 'offices:create'
  | 'settings:staff'
  | 'settings:duplicate-matching'
  | `office:${string}`;

const SECTIONS: Array<{ label: string; items: Array<{ key: AdminTab; label: string; icon: string }> }> = [
  { label: 'Analytics', items: [
    { key: 'dashboard', label: 'City overview', icon: 'chart' },
    { key: 'insights', label: 'Insights', icon: 'insights' },
    { key: 'visualizations:list', label: 'Visualizations', icon: 'viz' },
    { key: 'reports', label: 'Reports & exports', icon: 'download' },
  ] },
  { label: 'Records', items: [
    { key: 'citizens', label: 'Citizens', icon: 'users' },
    { key: 'households', label: 'Households', icon: 'home' },
    { key: 'queue', label: 'Duplicate review', icon: 'queue' },
  ] },
];
const MANAGE: Array<{ key: AdminTab; label: string; icon: string }> = [
  { key: 'offices:list', label: 'Offices', icon: 'building' },
  { key: 'settings:staff', label: 'Staff accounts', icon: 'staff' },
  { key: 'settings:duplicate-matching', label: 'Matching settings', icon: 'sliders' },
];

export const ADMIN_TAB_LABELS: Record<string, string> = {
  ...Object.fromEntries([...SECTIONS.flatMap((s) => s.items), ...MANAGE].map((i) => [i.key, i.label])),
  'visualizations:create': 'New visualization',
  'offices:create': 'Create office',
};

// The one place every office comes together -- a dark rail so it never
// reads as just another office workspace.
export function AdminSidebar({ activeTab, onSelect, offices, queueCount, footer }: {
  activeTab: AdminTab;
  onSelect: (tab: AdminTab) => void;
  offices: Office[];
  queueCount: number;
  footer: React.ReactNode;
}) {
  const isActive = (key: AdminTab) =>
    activeTab === key ||
    (key === 'visualizations:list' && activeTab === 'visualizations:create') ||
    (key === 'offices:list' && activeTab === 'offices:create');

  return (
    <aside className="d-sidebar ws-rail--admin">
      <div className="brand">
        <div className="brand-logo"><img src={logoUrl} alt="City of Vigan seal" /></div>
        <div className="brand-text">
          <div className="brand-name">Vigan City Records</div>
          <div className="brand-tag">ADMINISTRATION CONSOLE</div>
        </div>
      </div>

      <nav className="nav-section">
        {SECTIONS.map((s) => (
          <div key={s.label}>
            <div className="nav-label">{s.label}</div>
            {s.items.map((i) => (
              <NavButton key={i.key} active={isActive(i.key)} icon={i.icon} label={i.label} badge={i.key === 'queue' ? queueCount : undefined} onClick={() => onSelect(i.key)} />
            ))}
          </div>
        ))}

        <div className="nav-label">Office workspaces</div>
        {offices.filter((o) => o.isActive).map((o) => {
          const { hue, icon } = officeAppearance(o);
          return <NavButton key={o.id} active={activeTab === `office:${o.id}`} icon={icon} tileHue={hue} label={shortName(o.name)} onClick={() => onSelect(`office:${o.id}`)} />;
        })}

        <div className="nav-label">Manage</div>
        {MANAGE.map((i) => <NavButton key={i.key} active={isActive(i.key)} icon={i.icon} label={i.label} onClick={() => onSelect(i.key)} />)}
      </nav>

      <div className="sidebar-footer">{footer}</div>
    </aside>
  );
}
