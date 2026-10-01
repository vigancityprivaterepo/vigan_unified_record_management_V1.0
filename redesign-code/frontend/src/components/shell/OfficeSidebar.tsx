import logoUrl from '@/logo.png';
import { Icon } from '@/components/Icon';
import type { Office, OfficeModule } from '@/lib/api';
import { moduleIcon, officeAppearance } from '@/lib/officeTheme';

export type OfficeTab = 'home' | `intake:${string}` | `records:${string}`;

// Scoped navigation for one office: its identity at the top, then one
// "New registration" + "Records" pair per module. Nothing from other offices
// or admin ever appears here.
export function OfficeSidebar({
  office,
  modules,
  activeTab,
  onSelect,
  counts,
  footer,
}: {
  office: Office | null;
  modules: OfficeModule[];
  activeTab: OfficeTab;
  onSelect: (tab: OfficeTab) => void;
  counts: Record<string, number | undefined>;
  footer: React.ReactNode;
}) {
  const { icon } = officeAppearance(office);
  const multi = modules.length > 1;
  const short = office ? shortName(office.name) : 'Office';

  return (
    <aside className="d-sidebar ws-rail--office">
      <div className="ws-identity">
        <div className="ws-identity-city">
          <img src={logoUrl} alt="" />
          City Government of Vigan
        </div>
        <div className="ws-identity-row">
          <div className="ws-tile"><Icon name={icon} size={26} strokeWidth={1.8} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="ws-identity-short">{short}</div>
            <div className="ws-identity-full">{office?.name}</div>
          </div>
        </div>
      </div>

      <nav className="nav-section">
        <NavButton active={activeTab === 'home'} icon="home" label="Home" onClick={() => onSelect('home')} />
        {modules.map((m) => (
          <div key={m.id}>
            <div className="nav-label">{m.name}</div>
            <NavButton
              active={activeTab === `intake:${m.id}`}
              icon="plus"
              label={multi ? 'New registration' : `Register: ${m.name}`}
              onClick={() => onSelect(`intake:${m.id}`)}
            />
            <NavButton
              active={activeTab === `records:${m.id}`}
              icon="list"
              label="Records"
              count={counts[m.id]}
              onClick={() => onSelect(`records:${m.id}`)}
            />
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {footer}
      </div>
    </aside>
  );
}

export function NavButton({ active, icon, label, count, badge, tileHue, onClick }: {
  active: boolean; icon: string; label: string; count?: number; badge?: number; tileHue?: number; onClick: () => void;
}) {
  return (
    <button type="button" className={`nav-link${active ? ' is-active' : ''}`} onClick={onClick}>
      {tileHue !== undefined ? (
        <span className="ws-tile ws-tile--sm" style={{ background: `oklch(0.5 0.14 ${tileHue})` }}><Icon name={icon} size={15} /></span>
      ) : (
        <Icon name={icon} />
      )}
      <span>{label}</span>
      {badge ? <span className="ws-badge">{badge}</span> : count !== undefined ? <span className="ws-count">{compact(count)}</span> : null}
    </button>
  );
}

export function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n);
}

// "City Social Welfare and Development Office" -> "Social Welfare and Development"
// is still long, so offices with a well-known acronym-style slug use it.
export function shortName(name: string): string {
  const s = name.replace(/^City\s+/i, '').replace(/\s+Office$/i, '');
  if (/social welfare/i.test(s)) return 'CSWD';
  return s;
}
