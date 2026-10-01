import { ICONS } from '@/lib/officeTheme';

export function Icon({ name, size = 18, strokeWidth = 1.9, className }: { name: string; size?: number; strokeWidth?: number; className?: string }) {
  const paths = ICONS[name] ?? ICONS.records ?? [];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
