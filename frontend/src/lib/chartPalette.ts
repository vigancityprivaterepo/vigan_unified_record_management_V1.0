import { useEffect, useState } from 'react';

// App.tsx's own theme toggle sets `data-theme` on <html> but doesn't export
// its state -- charts read the attribute directly and re-render on change
// via a MutationObserver, rather than threading theme through props from
// the app shell down to every chart.
export function useChartTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

// Fixed categorical palette for the Insights dashboard -- one color per
// membership-category module, same slot everywhere it appears (Sankey
// nodes/links, household-tree category tags, any legend). Deliberately
// separate from WidgetCard.tsx's own hash-based colorForModule, which
// serves a different page (Visualizations) under a different color
// contract -- do not merge the two.
//
// Order and hexes are the data-viz skill's validated default: eight hues in
// a fixed order that clears CVD-safety checks as *adjacent* pairs (Sankey
// links, tree edges). Never reorder, never cycle past 8 -- a 9th+ module
// folds to the neutral "Other" gray instead of a generated hue.
export type Theme = 'light' | 'dark';

// Same colorblind-safe Okabe-Ito set as lib/chartTheme (teal first, no
// purple), so Insights and Visualizations read as one system. Six hues; a
// 7th+ module folds to the neutral "Other" gray.
const CATEGORICAL_LIGHT = ['#0F766E', '#0072B2', '#D55E00', '#CC79A7', '#E69F00', '#009E73'];
const CATEGORICAL_DARK = ['#2DD4BF', '#56B4E9', '#F0884A', '#E3A3C9', '#F2C063', '#5FD3A5'];

// Reuses the app's existing muted-text tokens rather than inventing a new
// gray -- see adminator.css's --t-muted.
const OTHER_GRAY: Record<Theme, string> = { light: '#9CA3AF', dark: '#6F9C8D' };

export function categoricalPalette(theme: Theme): string[] {
  return theme === 'dark' ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
}

// `orderedModuleIds` is always the backend's canonical order (see
// insights.ts's membershipModules -- createdAt then id, append-only) so a
// module's slot never reshuffles as new modules are added.
export function paletteSlotForModule(moduleId: string, orderedModuleIds: string[], theme: Theme): string {
  const palette = categoricalPalette(theme);
  const idx = orderedModuleIds.indexOf(moduleId);
  if (idx === -1 || idx >= palette.length) return OTHER_GRAY[theme];
  return palette[idx] ?? OTHER_GRAY[theme];
}

// Sequential blue ramp for a *magnitude* read (barangay density) -- never
// used for identity. 13 steps, light mode only per the data-viz skill's
// reference (100 lightest/near-zero -> 700 darkest/highest).
// Single-hue teal ramp (brand-anchored), light to dark.
const SEQUENTIAL_BLUE_LIGHT = [
  '#E6F4F1', '#CCE9E3', '#B2DDD5', '#99D2C7', '#7FC6B9', '#66BAAB', '#4DAE9D', '#33A28F', '#1A9681', '#0F766E', '#0B6A62', '#085D56', '#054F49',
];

const DARK_CHART_SURFACE = '#183D35';
const DARK_CATEGORICAL_BLUE = '#2DD4BF';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Dark mode has no published sequential ramp in the data-viz skill's
// reference -- rather than guess fixed hex steps, this interpolates at
// render time between the dark chart surface (near-zero) and the dark
// categorical blue (max), which is a smooth ramp rather than a stored
// identity palette and so doesn't need the six-check validator (that only
// judges categorical palettes).
export function sequentialBlueForValue(value: number, min: number, max: number, theme: Theme): string {
  const t = max > min ? clamp01((value - min) / (max - min)) : 0;
  if (theme === 'light') {
    const stepCount = SEQUENTIAL_BLUE_LIGHT.length;
    const idx = Math.min(stepCount - 1, Math.floor(t * stepCount));
    return SEQUENTIAL_BLUE_LIGHT[idx] ?? SEQUENTIAL_BLUE_LIGHT[stepCount - 1]!;
  }
  return rgbToHex(lerpRgb(hexToRgb(DARK_CHART_SURFACE), hexToRgb(DARK_CATEGORICAL_BLUE), t));
}
