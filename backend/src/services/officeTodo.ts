import type { PrismaClient } from '@prisma/client';
import { BUSINESS_PERMITS_SLUG, summarizeRenewals } from './businessRenewals';
import { reliefEvents, summarize } from './disasterLists';
import { countGap, toGapRule } from './programGaps';

// An office's to-do list for its Home page: counts only (no names), each
// pointing at the page where the people or businesses are listed. Built
// from the same services as those pages, so the numbers always agree.
//   - Program gaps: active rules that target this office's programs
//   - Disaster lists (office runs Evacuees): residents in an evacuation
//     center now; households not yet reached by the latest relief event
//   - Business renewals (office runs Business Permits): not renewed this year
//   - Registrations waiting for the administrator's duplicate review
// Items with nothing to do are left out.

export type TodoItem = {
  key: string;
  count: number;
  label: string;
  detail: string;
  go: string; // office tab: 'gaps' | 'disaster' | 'renewals' | `records:${moduleId}`
};

export async function officeTodo(client: PrismaClient, officeId: string): Promise<TodoItem[]> {
  const modules = await client.officeModule.findMany({ where: { officeId }, select: { id: true, name: true, slug: true } });
  const slugs = new Set(modules.map((m) => m.slug));
  const items: TodoItem[] = [];

  const rules = await client.programGapRule.findMany({ where: { isActive: true, targetModule: { officeId } }, orderBy: [{ kind: 'desc' }, { createdAt: 'asc' }] });
  for (const row of rules) {
    const { total } = await countGap(client, toGapRule(row), {});
    if (total > 0) {
      items.push({
        key: `gap:${row.id}`, count: total, label: row.name, go: 'gaps',
        detail: row.kind === 'conflict' ? 'Check before the next payout or report' : 'Not yet in this program; open the list to follow up',
      });
    }
  }

  if (slugs.has('evacuees')) {
    const { totals } = await summarize(client, {});
    if (totals.evacuatedNow > 0) {
      items.push({ key: 'evacuated', count: totals.evacuatedNow, label: 'Residents who may need help, in an evacuation center now', detail: 'Not yet marked as returned home', go: 'disaster' });
    }
    const latest = (await reliefEvents(client))[0];
    if (latest) {
      const r = (await summarize(client, { event: latest.event })).totals;
      const left = r.households - r.reliefHouseholds;
      if (left > 0) items.push({ key: 'relief', count: left, label: `Households not yet reached by relief: ${latest.label}`, detail: `Of ${r.households.toLocaleString()} households that may need help`, go: 'disaster' });
    }
  }

  if (slugs.has(BUSINESS_PERMITS_SLUG)) {
    const s = await summarizeRenewals(client);
    if (s.notRenewed > 0) items.push({ key: 'renewals', count: s.notRenewed, label: `Businesses not renewed for ${s.year}`, detail: `Last permit was in ${s.year - 1}`, go: 'renewals' });
  }

  const pending = await client.duplicateReviewQueueItem.groupBy({
    by: ['moduleId'], where: { status: 'pending', moduleId: { in: modules.map((m) => m.id) } }, _count: { _all: true },
  });
  for (const p of pending) {
    const m = modules.find((x) => x.id === p.moduleId);
    if (m && p._count._all > 0) {
      items.push({ key: `review:${m.id}`, count: p._count._all, label: `${m.name} registrations waiting for duplicate review`, detail: 'The administrator decides; nothing to do here yet', go: `records:${m.id}` });
    }
  }
  return items;
}
