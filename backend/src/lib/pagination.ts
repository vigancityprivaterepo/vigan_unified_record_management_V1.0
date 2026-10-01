// Shared page-number parsing for every paginated list endpoint (office
// records, citizens, households) -- one fixed page size per list, no
// client-controlled page size, matching this codebase's preference for a
// small fixed recipe over an open-ended query surface (see e.g.
// dashboardWidgets.ts's own comment on the same philosophy).
export function parsePage(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
