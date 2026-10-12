import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { computeWidgetData } from '../services/dashboardWidgets';
import { exploreHistory, exploreProfile, exploreRecords, exploreRecordsCsv, labelOf } from './widgetExploreHandlers';

// Admin-authored custom dashboard visualizations -- see the DashboardWidget
// model's comment in schema.prisma and services/dashboardWidgets.ts for the
// "fixed recipe" design (one or more source modules + optional group-by +
// chart type) this is built from. Every module -- CSWD/Agriculture/Civil
// Registry included, not just admin-created offices -- is a valid widget
// source since they all now store records the same way, and a widget can
// consolidate several of them onto one chart (one series per module).
export const adminDashboardWidgetsRouter = Router();
adminDashboardWidgetsRouter.use(requireRole('admin'));

// Reasonable ceiling on how many series one chart can usefully show --
// not a hard architectural limit, just a sanity bound.
export const MAX_SOURCES = 8;

export const WIDGET_SELECT = {
  id: true,
  officeId: true,
  title: true,
  groupBy: true,
  chartType: true,
  sortOrder: true,
  showOnDashboard: true,
  measure: true,
  filterBarangayCode: true,
  filterSex: true,
  filterMonth: true,
  filterFieldKey: true,
  filterFieldValue: true,
  sources: {
    select: { moduleId: true, module: { select: { name: true, office: { select: { name: true } } } } },
  },
} as const;

export function serializeWidget(
  widget: { filterBarangayCode: string | null; sources: Array<{ moduleId: string; module: { name: string; office: { name: string } } }> } & Record<string, unknown>,
  barangayNameByCode: Map<string, string> = new Map(),
) {
  const { sources, ...rest } = widget;
  return {
    ...rest,
    filterBarangayName: widget.filterBarangayCode ? (barangayNameByCode.get(widget.filterBarangayCode) ?? null) : null,
    sourceModules: sources.map((s) => ({ id: s.moduleId, name: s.module.name, officeName: s.module.office.name })),
  };
}

export async function sampleModuleIds(client: PrismaClient): Promise<Set<string>> {
  const rows = await client.$queryRaw<Array<{ module_id: string }>>`
    SELECT DISTINCT module_id FROM office_record WHERE is_archived = false AND data ? '_sample'`;
  return new Set(rows.map((r) => r.module_id));
}

// Computes one widget's chart rows; shared by the admin and office routes.
export async function widgetData(client: PrismaClient, widgetId: string) {
  const widget = await client.dashboardWidget.findUnique({
    where: { id: widgetId },
    select: {
      groupBy: true,
      measure: true,
      filterBarangayCode: true,
      filterSex: true,
      filterMonth: true,
      filterFieldKey: true,
      filterFieldValue: true,
      sources: { select: { moduleId: true } },
    },
  });
  if (!widget) return null;
  return computeWidgetData(client, {
    moduleIds: widget.sources.map((s) => s.moduleId),
    groupBy: widget.groupBy,
    measure: widget.measure,
    filters: {
      barangayCode: widget.filterBarangayCode ?? undefined,
      sex: widget.filterSex ?? undefined,
      month: widget.filterMonth ?? undefined,
      fieldKey: widget.filterFieldKey ?? undefined,
      fieldValue: widget.filterFieldValue ?? undefined,
    },
  });
}

adminDashboardWidgetsRouter.get('/', async (_req, res) => {
  const client = getPrismaForRole('admin');
  const widgets = await client.dashboardWidget.findMany({
    select: WIDGET_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const codes = [...new Set(widgets.map((w) => w.filterBarangayCode).filter((c): c is string => c !== null))];
  const barangays = codes.length ? await client.barangay.findMany({ where: { code: { in: codes } } }) : [];
  const barangayNameByCode = new Map(barangays.map((b) => [b.code, b.name]));

  // Widgets drawing on SAMPLE-tagged records say so in the UI.
  const sampleModules = await sampleModuleIds(client);
  res.json(
    widgets.map((w) => ({
      ...serializeWidget(w, barangayNameByCode),
      hasSampleData: w.sources.some((s) => sampleModules.has(s.moduleId)),
    })),
  );
});

const GROUP_BY_VALUES = ['barangay', 'sex', 'month', 'age_bracket', 'other_programs'] as const;
// Sanity bound on how many dimensions one chart can usefully cross before
// the composite label gets unreadable -- not an architectural limit.
const MAX_GROUP_BY_DIMENSIONS = 2;

const groupByDimension = z.union([z.enum(GROUP_BY_VALUES), z.string().regex(/^field:.+$/)]);

export const widgetPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sourceModuleIds: z.array(z.string().uuid()).min(1).max(MAX_SOURCES),
  // 0-2 dimensions -- with 2, the resulting chart's label is their
  // composite ("Poblacion / M"). Each "field:<key>" one is validated below
  // (needs a DB lookup, can't be done in the schema itself).
  groupBy: z.array(groupByDimension).max(MAX_GROUP_BY_DIMENSIONS).optional(),
  // donut: same grouped rows as bar/line, drawn as shares of the total.
  chartType: z.enum(['bar', 'line', 'donut', 'number']),
  // 'count' (default) or 'sum:<fieldKey>' of a NUMBER field on a selected module.
  measure: z.union([z.literal('count'), z.literal('people'), z.string().regex(/^sum:.+$/)]).optional(),
  // Narrows the query without being a chart axis -- distinct from groupBy.
  // filterBarangayCode is validated against the Barangay table below (same
  // DB-lookup reasoning as the field:<key> groupBy check).
  filterBarangayCode: z.string().max(10).optional(),
  filterSex: z.string().trim().min(1).max(20).optional(),
  filterMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .optional(),
  // Both or neither: "only records where this form field has this value".
  filterFieldKey: z.string().trim().min(1).max(120).optional(),
  filterFieldValue: z.string().trim().min(1).max(200).optional(),
});

// Shared by create (POST) and edit (PATCH) -- same recipe, same validation
// (modules exist, a field:<key> dimension exists on at least one selected
// module, filterBarangayCode is a real barangay). Returns the normalized
// values plus the matched barangay (for the response's filterBarangayName)
// on success, or null after already sending an error response.
export async function validateWidgetPayload(
  client: PrismaClient,
  res: Response,
  data: z.infer<typeof widgetPayloadSchema>,
): Promise<{ sourceModuleIds: string[]; groupBy: string[]; filterBarangay: { code: string; name: string } | null } | null> {
  const sourceModuleIds = [...new Set(data.sourceModuleIds)];
  // A "number" widget shows one total per module -- any group-by dimension
  // is meaningless for it, so it's dropped rather than silently ignored later.
  const groupBy = data.chartType === 'number' ? [] : [...new Set(data.groupBy ?? [])];

  const modules = await client.officeModule.findMany({ where: { id: { in: sourceModuleIds } } });
  if (modules.length !== sourceModuleIds.length) {
    sendError(res, 400, 'VALIDATION_ERROR', 'One or more programs were not found', {
      sourceModuleIds: ['One or more programs were not found'],
    });
    return null;
  }

  for (const dim of groupBy) {
    if (!dim.startsWith('field:')) continue;
    // A field-keyed dimension works across any mix of modules -- it just
    // needs to exist on at least one of them (e.g. CSWD's Senior/PWD/Solo
    // Parent all define "has_id", but even picking a module that doesn't
    // have this key is fine: computeModuleRows reads data->>key per module,
    // so a module without the field just buckets its rows under a blank
    // label instead of failing).
    const key = dim.slice('field:'.length);
    const field = await client.officeFormField.findFirst({ where: { moduleId: { in: sourceModuleIds }, key } });
    if (!field) {
      sendError(res, 400, 'VALIDATION_ERROR', 'No selected program has this field', {
        groupBy: [`No selected program has the field "${key}"`],
      });
      return null;
    }
  }

  if (!!data.filterFieldKey !== !!data.filterFieldValue) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Pick both a field and a value to filter on', {
      filterFieldKey: ['Pick both a field and a value'],
    });
    return null;
  }
  if (data.filterFieldKey) {
    const field = await client.officeFormField.findFirst({ where: { moduleId: { in: sourceModuleIds }, key: data.filterFieldKey } });
    if (!field) {
      sendError(res, 400, 'VALIDATION_ERROR', 'No selected program has this field', {
        filterFieldKey: [`No selected program has the field "${data.filterFieldKey}"`],
      });
      return null;
    }
  }

  if (data.measure && data.measure.startsWith('sum:')) {
    const key = data.measure.slice('sum:'.length);
    const field = await client.officeFormField.findFirst({ where: { moduleId: { in: sourceModuleIds }, key, fieldType: 'NUMBER' } });
    if (!field) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Sum needs a number field on a selected program', {
        measure: [`No selected program has a number field "${key}"`],
      });
      return null;
    }
  }

  let filterBarangay: { code: string; name: string } | null = null;
  if (data.filterBarangayCode) {
    filterBarangay = await client.barangay.findUnique({ where: { code: data.filterBarangayCode } });
    if (!filterBarangay) {
      sendError(res, 400, 'VALIDATION_ERROR', 'No such barangay', {
        filterBarangayCode: ['No such barangay'],
      });
      return null;
    }
  }

  return { sourceModuleIds, groupBy, filterBarangay };
}

adminDashboardWidgetsRouter.post('/', async (req, res) => {
  const parsed = widgetPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid widget payload', parsed.error.flatten());
    return;
  }
  const { title, chartType } = parsed.data;
  const client = getPrismaForRole('admin');

  const validated = await validateWidgetPayload(client, res, parsed.data);
  if (!validated) return;
  const { sourceModuleIds, groupBy, filterBarangay } = validated;

  const maxSort = await client.dashboardWidget.aggregate({ _max: { sortOrder: true } });

  const widget = await client.dashboardWidget.create({
    data: {
      title,
      groupBy,
      chartType,
      measure: parsed.data.measure ?? 'count',
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      createdBy: req.session.userId,
      filterBarangayCode: parsed.data.filterBarangayCode,
      filterSex: parsed.data.filterSex,
      filterMonth: parsed.data.filterMonth,
      filterFieldKey: parsed.data.filterFieldKey,
      filterFieldValue: parsed.data.filterFieldValue,
      sources: { create: sourceModuleIds.map((moduleId) => ({ moduleId })) },
    },
    select: WIDGET_SELECT,
  });

  await insertAuditLog(client, {
    tableName: 'dashboard_widget',
    recordId: widget.id,
    action: 'insert',
    actorUserId: req.session.userId,
    actorRole: req.session.role,
    changedFields: {
      title,
      sourceModuleIds,
      groupBy,
      chartType,
      measure: parsed.data.measure ?? 'count',
      filterBarangayCode: parsed.data.filterBarangayCode,
      filterSex: parsed.data.filterSex,
      filterMonth: parsed.data.filterMonth,
      filterFieldKey: parsed.data.filterFieldKey,
      filterFieldValue: parsed.data.filterFieldValue,
    },
  });

  res.status(201).json(serializeWidget(widget, filterBarangay ? new Map([[filterBarangay.code, filterBarangay.name]]) : undefined));
});

adminDashboardWidgetsRouter.patch('/:id', async (req, res) => {
  const client = getPrismaForRole('admin');
  const existing = await client.dashboardWidget.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    sendError(res, 404, 'NOT_FOUND', 'No such widget');
    return;
  }

  const parsed = widgetPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid widget payload', parsed.error.flatten());
    return;
  }
  const { title, chartType } = parsed.data;

  const validated = await validateWidgetPayload(client, res, parsed.data);
  if (!validated) return;
  const { sourceModuleIds, groupBy, filterBarangay } = validated;

  // Full replace of the recipe -- the edit form always submits the complete
  // state, so there's no partial-update case to reconcile. Sources are
  // swapped wholesale (delete then recreate) rather than diffed, same
  // "whole recipe, not incremental edits" spirit as the rest of this model.
  const widget = await client.$transaction(async (tx) => {
    await tx.dashboardWidgetSource.deleteMany({ where: { widgetId: req.params.id } });
    return tx.dashboardWidget.update({
      where: { id: req.params.id },
      data: {
        title,
        groupBy,
        chartType,
        measure: parsed.data.measure ?? 'count',
        filterBarangayCode: parsed.data.filterBarangayCode ?? null,
        filterSex: parsed.data.filterSex ?? null,
        filterMonth: parsed.data.filterMonth ?? null,
        filterFieldKey: parsed.data.filterFieldKey ?? null,
        filterFieldValue: parsed.data.filterFieldValue ?? null,
        sources: { create: sourceModuleIds.map((moduleId) => ({ moduleId })) },
      },
      select: WIDGET_SELECT,
    });
  });

  await insertAuditLog(client, {
    tableName: 'dashboard_widget',
    recordId: widget.id,
    action: 'update',
    actorUserId: req.session.userId,
    actorRole: req.session.role,
    changedFields: {
      title,
      sourceModuleIds,
      groupBy,
      chartType,
      measure: parsed.data.measure ?? 'count',
      filterBarangayCode: parsed.data.filterBarangayCode,
      filterSex: parsed.data.filterSex,
      filterMonth: parsed.data.filterMonth,
      filterFieldKey: parsed.data.filterFieldKey,
      filterFieldValue: parsed.data.filterFieldValue,
    },
  });

  res.json(serializeWidget(widget, filterBarangay ? new Map([[filterBarangay.code, filterBarangay.name]]) : undefined));
});

// On/off for the admin Dashboard only -- separate from PATCH /:id, which
// always takes the complete recipe.
export const dashboardToggleSchema = z.object({ showOnDashboard: z.boolean() });

adminDashboardWidgetsRouter.patch(
  '/:id/dashboard',
  asyncHandler(async (req, res) => {
    const parsed = dashboardToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid payload', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole('admin');
    const existing = await client.dashboardWidget.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such widget');
      return;
    }
    const widget = await client.dashboardWidget.update({
      where: { id: req.params.id },
      data: { showOnDashboard: parsed.data.showOnDashboard },
      select: WIDGET_SELECT,
    });
    await insertAuditLog(client, {
      tableName: 'dashboard_widget',
      recordId: widget.id,
      action: 'update',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: parsed.data,
    });
    res.json(serializeWidget(widget));
  }),
);

adminDashboardWidgetsRouter.delete('/:id', async (req, res) => {
  const client = getPrismaForRole('admin');
  const existing = await client.dashboardWidget.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    sendError(res, 404, 'NOT_FOUND', 'No such widget');
    return;
  }

  // DashboardWidgetSource rows cascade with the widget (ON DELETE CASCADE).
  await client.dashboardWidget.delete({ where: { id: req.params.id } });

  await insertAuditLog(client, {
    tableName: 'dashboard_widget',
    recordId: existing.id,
    action: 'delete',
    actorUserId: req.session.userId,
    actorRole: req.session.role,
    changedFields: { title: existing.title },
  });

  res.status(204).send();
});

adminDashboardWidgetsRouter.get('/:id/data', async (req, res) => {
  const client = getPrismaForRole('admin');
  const widget = await client.dashboardWidget.findUnique({
    where: { id: req.params.id },
    select: {
      groupBy: true,
      measure: true,
      filterBarangayCode: true,
      filterSex: true,
      filterMonth: true,
      filterFieldKey: true,
      filterFieldValue: true,
      sources: { select: { moduleId: true } },
    },
  });
  if (!widget) {
    sendError(res, 404, 'NOT_FOUND', 'No such widget');
    return;
  }

  try {
    const data = await computeWidgetData(client, {
      moduleIds: widget.sources.map((s) => s.moduleId),
      groupBy: widget.groupBy,
      measure: widget.measure,
      filters: {
        barangayCode: widget.filterBarangayCode ?? undefined,
        sex: widget.filterSex ?? undefined,
        month: widget.filterMonth ?? undefined,
        fieldKey: widget.filterFieldKey ?? undefined,
        fieldValue: widget.filterFieldValue ?? undefined,
      },
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to compute widget data');
  }
});

// What is behind a chart: its records, its history, and what its programs collect.
adminDashboardWidgetsRouter.get('/:id/explore/records', asyncHandler((req, res) => exploreRecords(getPrismaForRole('admin'), req, res, req.params.id!)));
adminDashboardWidgetsRouter.get('/:id/explore/records.csv', asyncHandler((req, res) => exploreRecordsCsv(getPrismaForRole('admin'), req, res, req.params.id!)));
adminDashboardWidgetsRouter.get('/:id/explore/history', asyncHandler((req, res) => exploreHistory(getPrismaForRole('admin'), req, res, req.params.id!, labelOf(req))));
adminDashboardWidgetsRouter.get('/:id/explore/profile', asyncHandler((req, res) => exploreProfile(getPrismaForRole('admin'), req, res, req.params.id!)));
