import { Icon } from '@/components/Icon';
import { ICONS, officeColor } from '@/lib/officeTheme';

// A small colored icon tile that names one office. DESIGN.md keeps office
// color on icons only; a bare colored dot cannot tell 30+ offices apart once
// the hues repeat, the icon plus the accessible name can.
export function OfficeMark({ name, hue, icon }: { name: string; hue: number; icon?: string | null }) {
  return (
    <span className="ws-tile ws-tile--xs" role="img" aria-label={name} title={name} style={{ background: officeColor(hue, 'acc') }}>
      <Icon name={icon && ICONS[icon] ? icon : 'building'} size={12} strokeWidth={2.2} />
    </span>
  );
}
