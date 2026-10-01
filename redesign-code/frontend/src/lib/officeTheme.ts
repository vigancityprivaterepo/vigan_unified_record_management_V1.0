import type { Office, OfficeModule } from '@/lib/api';

// Every office's visual identity is one hue (0-359) + one icon key, stored on
// the Office row (accent_hue / icon). workspace.css turns the hue into the
// full --primary* token set via oklch(), so every existing component that
// already uses --primary recolors per office with no per-component work.

export const ICONS: Record<string, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20h14V9.5', 'M10 20v-5h4v5'],
  plus: ['M12 5v14', 'M5 12h14'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  chart: ['M4 20V11', 'M10 20V5', 'M16 20v-6', 'M21 20H3'],
  insights: ['M4 3v16a2 2 0 0 0 2 2h16', 'M4 14l4-3 4 2 4-6 4 3'],
  viz: ['M3 3v18h18', 'M7 15l4-5 3 3 5-7'],
  users: ['M9 3.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6', 'M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5', 'M17.5 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4', 'M15.5 20c.2-2 1.3-3.5 4-3.5'],
  queue: ['M4 6h16', 'M4 12h9', 'M4 18h6', 'm15 17 2 2 4-4'],
  building: ['M4 21V4h10v17', 'M14 9h6v12', 'M8 8h2', 'M8 12h2', 'M8 16h2', 'M3 21h18'],
  staff: ['M9 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M2 21c0-3.5 3-6 7-6s7 2.5 7 6', 'M16 11h6', 'M19 8v6'],
  sliders: ['M4 6h9', 'M17 6h3', 'M15 4v4', 'M4 12h3', 'M11 12h9', 'M9 10v4', 'M4 18h11', 'M19 18h1', 'M17 16v4'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z', 'm9 12 2 2 4-4'],
  lock: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  check: ['m5 12 5 5 9-10'],
  arrowL: ['M19 12H5', 'm11 6-6 6 6 6'],
  arrowR: ['M5 12h14', 'm13 6 6 6-6 6'],
  search: ['M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'm20 20-3.5-3.5'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  help: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14', 'M12 17h.01'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  // Office icons (pickable on Create/Edit office)
  sprout: ['M7 20h10', 'M12 20v-9', 'M12 11C12 7.5 9.5 5 5 5c0 4 2.5 6 7 6', 'M12 9c0-3 2.5-5 7-5c0 3.5-2.5 5-7 5'],
  heart: ['M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z'],
  scroll: ['M5 3h10l4 4v14H5z', 'M15 3v4h4', 'M9 12h6', 'M9 16h4'],
  clipboard: ['M9 3h6v3H9z', 'M9 4.5H6V21h12V4.5h-3', 'm9 14 2 2 4-4'],
  cross: ['M9 3h6v6h6v6h-6v6H9v-6H3V9h6z'],
  school: ['M2 9l10-5 10 5-10 5z', 'M6 11v5c3 2 9 2 12 0v-5'],
  // Module icons
  senior: ['M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M4 21c0-4 3.6-6 8-6s8 2 8 6'],
  pwd: ['M12 2.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3', 'M6 8h12', 'M12 8v6', 'M9 21l3-7 3 7'],
  family: ['M9 3.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6', 'M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5', 'M17.5 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4', 'M15.5 20c.2-2 1.3-3.5 4-3.5'],
  wheat: ['M12 21V9', 'M12 9c-2 0-3-1.5-3-4c2 0 3 1.5 3 4', 'M12 9c2 0 3-1.5 3-4c-2 0-3 1.5-3 4', 'M12 14c-2 0-3.5-1.5-3.5-3.5c2 0 3.5 1.5 3.5 3.5', 'M12 14c2 0 3.5-1.5 3.5-3.5c-2 0-3.5 1.5-3.5 3.5'],
  birth: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3'],
  death: ['M12 3v18', 'M7 8h10'],
  ticket: ['M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z', 'M14 7v10'],
  message: ['M4 5h16v11H9l-5 4z', 'M8 10h8'],
  records: ['M5 3h10l4 4v14H5z', 'M15 3v4h4'],
};

export const OFFICE_ICON_CHOICES = ['cross', 'building', 'school', 'shield', 'home', 'sprout', 'heart', 'scroll', 'clipboard'];

// Spread ~45-90 degrees apart so adjacent offices never look alike.
export const HUE_CHOICES: Array<{ hue: number; label: string }> = [
  { hue: 145, label: 'Green' }, { hue: 350, label: 'Magenta' }, { hue: 255, label: 'Blue' }, { hue: 65, label: 'Amber' },
  { hue: 20, label: 'Red' }, { hue: 195, label: 'Teal' }, { hue: 300, label: 'Violet' }, { hue: 110, label: 'Olive' },
];

export const ADMIN_HUE = 35; // Vigan brick -- the admin console's own accent

// Used only until the accent_hue/icon migration has run, so the UI still
// looks right against an older backend.
const FALLBACK: Record<string, { hue: number; icon: string }> = {
  agriculture: { hue: 145, icon: 'sprout' },
  cswd: { hue: 350, icon: 'heart' },
  civil_registry: { hue: 255, icon: 'scroll' },
  citizens_charter: { hue: 65, icon: 'clipboard' },
};

const MODULE_ICON_BY_SLUG: Record<string, string> = {
  senior: 'senior', pwd: 'pwd', solo_parent: 'family', farmer: 'wheat', birth: 'birth', death: 'death',
  request: 'ticket', service_request: 'ticket', feedback: 'message', client_feedback: 'message',
};

export function officeAppearance(office: Pick<Office, 'slug'> & { accentHue?: number | null; icon?: string | null } | null | undefined) {
  if (!office) return { hue: ADMIN_HUE, icon: 'building' };
  const fb = FALLBACK[office.slug];
  return { hue: office.accentHue ?? fb?.hue ?? 255, icon: office.icon && ICONS[office.icon] ? office.icon : fb?.icon ?? 'building' };
}

export function moduleIcon(m: Pick<OfficeModule, 'slug'>): string {
  return MODULE_ICON_BY_SLUG[m.slug] ?? 'records';
}

// Same formulas as workspace.css, for places that need several offices'
// colors on one screen (admin charts, office chips) where a single --hue on
// the shell can't express it.
export function officeColor(hue: number, kind: 'acc' | 'soft' | 'line' | 'deep' | 'chart', dark = document.documentElement.getAttribute('data-theme') === 'dark') {
  if (dark) {
    return { acc: `oklch(0.62 0.14 ${hue})`, soft: `oklch(0.25 0.04 ${hue})`, line: `oklch(0.37 0.06 ${hue})`, deep: `oklch(0.86 0.08 ${hue})`, chart: `oklch(0.66 0.14 ${hue})` }[kind];
  }
  return { acc: `oklch(0.50 0.14 ${hue})`, soft: `oklch(0.968 0.03 ${hue})`, line: `oklch(0.88 0.06 ${hue})`, deep: `oklch(0.36 0.11 ${hue})`, chart: `oklch(0.62 0.14 ${hue})` }[kind];
}

export function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : w[0]?.[1] ?? '')).toUpperCase();
}
