import { Icon } from '@/components/Icon';
import { HUE_CHOICES, OFFICE_ICON_CHOICES, officeColor } from '@/lib/officeTheme';

// Drop into CreateOfficePage (and the edit form in AllOfficesPage):
//   <OfficeAppearancePicker hue={hue} icon={icon} onChange={(p) => { ... }} usedBy={usedByHue} />
// and send { accentHue: hue, icon } with api.createOffice / api.updateOffice.
export function OfficeAppearancePicker({ hue, icon, onChange, usedBy = {}, previewName }: {
  hue: number;
  icon: string;
  onChange: (patch: { hue?: number; icon?: string }) => void;
  usedBy?: Record<number, string>;
  previewName?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="field">
        <span className="field-label">Workspace color</span>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {HUE_CHOICES.map((c) => {
            const on = c.hue === hue;
            const color = officeColor(c.hue, 'acc');
            return (
              <button key={c.hue} type="button" onClick={() => onChange({ hue: c.hue })} aria-pressed={on}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, width: 64, cursor: 'pointer' }}>
                <span style={{ width: 40, height: 40, borderRadius: '50%', background: color, boxShadow: on ? `0 0 0 3px var(--bg-card), 0 0 0 5px ${color}` : 'none', opacity: usedBy[c.hue] && !on ? 0.4 : 1 }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{c.label}</span>
                <span style={{ fontSize: 11, color: usedBy[c.hue] ? 'var(--t-light)' : 'var(--success)', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usedBy[c.hue] ?? 'Available'}</span>
              </button>
            );
          })}
        </div>
        {usedBy[hue] && <span className="field-hint" style={{ color: 'var(--warning)', fontWeight: 600 }}>{usedBy[hue]} already uses this color. Pick another so staff can tell offices apart.</span>}
      </div>

      <div className="field">
        <span className="field-label">Icon</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {OFFICE_ICON_CHOICES.map((k) => {
            const on = k === icon;
            return (
              <button key={k} type="button" onClick={() => onChange({ icon: k })} aria-pressed={on} aria-label={k}
                style={{ width: 50, height: 50, borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', cursor: 'pointer', border: on ? `2px solid ${officeColor(hue, 'acc')}` : '1px solid var(--border)', background: on ? officeColor(hue, 'soft') : 'var(--bg-card)', color: on ? officeColor(hue, 'deep') : 'var(--t-base)' }}>
                <Icon name={k} size={22} strokeWidth={1.8} />
              </button>
            );
          })}
        </div>
      </div>

      {previewName !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 'var(--r-lg)', background: officeColor(hue, 'soft'), border: `1px solid ${officeColor(hue, 'line')}` }}>
          <span className="ws-tile" style={{ background: officeColor(hue, 'acc') }}><Icon name={icon} size={24} strokeWidth={1.8} /></span>
          <div><div style={{ fontWeight: 600, fontSize: 17 }}>{previewName || 'New office'}</div><div style={{ fontSize: 12, color: 'var(--t-muted)' }}>How the sidebar will look for this office’s staff</div></div>
        </div>
      )}
    </div>
  );
}
