import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { sendCsv } from '../lib/csv';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { parsePage } from '../lib/pagination';
import { columnsFor, EXPORT_LIMIT, history, profile, records, RECORDS_PAGE_SIZE, type Recipe } from '../services/widgetExplore';

// "What is behind this chart": shared by the admin routes (any chart) and the
// office routes (charts that office may see). The caller has already checked
// the chart is visible to whoever is asking. Opening or exporting the records
// is audit-logged, like every other list of people in the app.

type Loaded = { title: string; recipe: Recipe; modules: Array<{ id: string; name: string }> };

async function load(client: PrismaClient, widgetId: string): Promise<Loaded | null> {
  const w = await client.dashboardWidget.findUnique({
    where: { id: widgetId },
    select: {
      title: true, groupBy: true, measure: true, filterBarangayCode: true, filterSex: true, filterMonth: true, filterFieldKey: true, filterFieldValue: true,
      sources: { select: { moduleId: true, module: { select: { name: true } } } },
    },
  });
  if (!w) return null;
  return {
    title: w.title,
    modules: w.sources.map((s) => ({ id: s.moduleId, name: s.module.name })),
    recipe: {
      groupBy: w.groupBy, measure: w.measure,
      filters: {
        barangayCode: w.filterBarangayCode ?? undefined, sex: w.filterSex ?? undefined, month: w.filterMonth ?? undefined,
        fieldKey: w.filterFieldKey ?? undefined, fieldValue: w.filterFieldValue ?? undefined,
      },
    },
  };
}

const labelOf = (req: Request) => (typeof req.query.label === 'string' ? req.query.label : undefined);

// The program whose records to list: ?moduleId, which must be one of the chart's.
function pickModule(req: Request, res: Response, w: Loaded): { id: string; name: string } | null {
  const asked = typeof req.query.moduleId === 'string' ? req.query.moduleId : w.modules[0]?.id;
  const module = w.modules.find((m) => m.id === asked);
  if (!module) sendError(res, 400, 'VALIDATION_ERROR', 'That program is not part of this chart');
  return module ?? null;
}

async function audit(client: PrismaClient, req: Request, widgetId: string, details: Record<string, unknown>) {
  await insertAuditLog(client, {
    tableName: 'office_record', recordId: null, action: 'read', actorUserId: req.session.userId, actorRole: req.session.role,
    changedFields: { source: 'chart', widgetId, officeId: req.params.officeId ?? null, ...details },
  });
}

export async function exploreRecords(client: PrismaClient, req: Request, res: Response, widgetId: string): Promise<void> {
  const w = await load(client, widgetId);
  if (!w) { sendError(res, 404, 'NOT_FOUND', 'No such chart'); return; }
  const module = pickModule(req, res, w);
  if (!module) return;
  const page = parsePage(req.query.page);
  const label = labelOf(req);
  const [columns, result] = await Promise.all([
    columnsFor(client, module.id),
    records(client, w.recipe, module.id, label, { limit: RECORDS_PAGE_SIZE, offset: (page - 1) * RECORDS_PAGE_SIZE }),
  ]);
  await audit(client, req, widgetId, { moduleId: module.id, label: label ?? null, page });
  res.json({ columns, items: result.items, total: result.total, page, pageSize: RECORDS_PAGE_SIZE });
}

export async function exploreRecordsCsv(client: PrismaClient, req: Request, res: Response, widgetId: string): Promise<void> {
  const w = await load(client, widgetId);
  if (!w) { sendError(res, 404, 'NOT_FOUND', 'No such chart'); return; }
  const module = pickModule(req, res, w);
  if (!module) return;
  const label = labelOf(req);
  const [columns, result] = await Promise.all([
    columnsFor(client, module.id),
    records(client, w.recipe, module.id, label, { limit: EXPORT_LIMIT, offset: 0 }),
  ]);
  await audit(client, req, widgetId, { moduleId: module.id, label: label ?? null, export: true, rows: result.items.length });
  sendCsv(
    res,
    `${w.title} - ${module.name}${label ? ` - ${label}` : ''}.csv`,
    ['Date added', 'Name', 'Barangay', 'Sex', 'Age', ...columns.map((c) => c.label), 'Sample data'],
    result.items.map((r) => [
      r.addedOn, r.person, r.barangay, r.sex, r.age,
      ...columns.map((c) => {
        const v = r.values[c.key];
        return Array.isArray(v) ? v.join('; ') : (v as string | number | boolean | null | undefined);
      }),
      r.sample ? 'Yes' : '',
    ]),
  );
}

export async function exploreHistory(client: PrismaClient, _req: Request, res: Response, widgetId: string, label: string | undefined): Promise<void> {
  const w = await load(client, widgetId);
  if (!w) { sendError(res, 404, 'NOT_FOUND', 'No such chart'); return; }
  res.json(await history(client, w.recipe, w.modules.map((m) => m.id), label));
}

export async function exploreProfile(client: PrismaClient, _req: Request, res: Response, widgetId: string): Promise<void> {
  const w = await load(client, widgetId);
  if (!w) { sendError(res, 404, 'NOT_FOUND', 'No such chart'); return; }
  res.json(await Promise.all(w.modules.map((m) => profile(client, m.id))));
}

export { labelOf };
