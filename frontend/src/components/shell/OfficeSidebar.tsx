import logoUrl from '@/logo.png';
import { Icon } from '@/components/Icon';
import type { Office, OfficeModule } from '@/lib/api';
import { officeAppearance, officeColor } from '@/lib/officeTheme';
import { adminShortName } from '@/lib/shortNames';

export type OfficeTab = 'home' | 'charts' | `intake:${string}` | `records:${string}`;

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
        <NavButton active={activeTab === 'charts'} icon="viz" label="Charts" onClick={() => onSelect('charts')} />
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
        <span className="ws-tile ws-tile--sm" style={{ background: officeColor(tileHue, 'acc') }}><Icon name={icon} size={15} /></span>
      ) : (
        <Icon name={icon} />
      )}
      <span title={label}>{label}</span>
      {badge ? <span className="ws-badge">{badge}</span> : count !== undefined ? <span className="ws-count">{compact(count)}</span> : null}
    </button>
  );
}

// 12.4K / 1.2M style (charts guide: round big numbers; exact value in a title).
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}K` : String(n);
}

// "City Social Welfare and Development Office" -> "Social Welfare and Development"
// is still long, so offices with a well-known acronym-style slug use it.
export function shortName(name: string): string {
  const set = adminShortName(name);
  if (set) return set;
  const s = name.replace(/^City\s+/i, '').replace(/\s+Office$/i, '');
  if (/social welfare/i.test(s)) return 'CSWD';
  if (/business permits/i.test(s)) return 'BPLO';
  if (/disaster risk/i.test(s)) return 'CDRRMO';
  if (/public employment/i.test(s)) return 'PESO';
  if (/environment and natural/i.test(s)) return 'CENRO';
  if (/livelihood/i.test(s)) return 'Livelihood';
  return s;
}
