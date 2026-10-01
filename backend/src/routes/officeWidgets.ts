import type { PrismaClient } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireOfficeAccess } from '../middleware/auth';
import {
  dashboardToggleSchema,
  sampleModuleIds,
  serializeWidget,
  validateWidgetPayload,
  WIDGET_SELECT,
  widgetData,
  widgetPayloadSchema,
} from './adminDashboardWidgets';

// Office staff's own charts, so each office can tell its own data story.
// Same recipe/validation as admin's visualizations (adminDashboardWidgets.ts),
// scoped to one office:
//  - sources may only be this office's programs;
//  - a chart this office creates is owned by it (dashboard_widget.office_id)
//    and only this office (or admin) can edit/delete it;
//  - staff also see admin's city-wide charts built purely from their office's
//    programs, read-only.
// "On dashboard" for an office chart means pinned to that office's Home.
// requireOfficeAccess keeps office_staff to their own :officeId (admin passes).
export const officeWidgetsRouter = Router();

async function officeModuleIds(client: PrismaClient, officeId: string): Promise<Set<string>> {
  const mods = await client.officeModule.findMany({ where: { officeId }, select: { id: true } });
  return new Set(mods.map((m) => m.id));
}

// Visible to an office: owned by it, or city-wide with every source in it.
function visibleTo(w: { officeId: string | null; sources: Array<{ moduleId: string }> }, officeId: string, mods: Set<string>): boolean {
  if (w.officeId === officeId) return true;
  return w.officeId === null && w.sources.length > 0 && w.sources.every((s) => mods.has(s.moduleId));
}

async function loadOwned(client: PrismaClient, req: Request, res: Response) {
  const widget = await client.dashboardWidget.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, officeId: true } });
  if (!widget || widget.officeId !== req.params.officeId) {
    sendError(res, 404, 'NOT_FOUND', 'No such chart for this office');
    return null;
  }
  return widget;
}

officeWidgetsRouter.get(
  '/:officeId/widgets',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const officeId = req.params.officeId!;
    const [mods, widgets, samples] = await Promise.all([
      officeModuleIds(client, officeId),
      client.dashboardWidget.findMany({ select: WIDGET_SELECT, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      sampleModuleIds(client),
    ]);
    res.json(
      widgets
        .filter((w) => visibleTo(w, officeId, mods))
        .map((w) => ({
          ...serializeWidget(w),
          editable: w.officeId === officeId,
          hasSampleData: w.sources.some((s) => samples.has(s.moduleId)),
        })),
    );
  }),
);

// Shared by create + update: payload shape, recipe validation, and "every
// source belongs to this office".
async function parseOfficePayload(client: PrismaClient, req: Request, res: Response) {
  const parsed = widgetPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid chart', parsed.error.flatten());
    return null;
  }
  const mods = await officeModuleIds(client, req.params.officeId!);
  if (!parsed.data.sourceModuleIds.every((id) => mods.has(id))) {
    sendError(res, 403, 'FORBIDDEN', "Charts can only use your own office's programs", {
      sourceModuleIds: ["Pick programs from your own office"],
    });
    return null;
  }
  const validated = await validateWidgetPayload(client, res, parsed.data);
  if (!validated) return null;
  return { data: parsed.data, ...validated };
}

officeWidgetsRouter.post(
  '/:officeId/widgets',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const p = await parseOfficePayload(client, req, res);
    if (!p) return;
    const maxSort = await client.dashboardWidget.aggregate({ _max: { sortOrder: true } });
    const widget = await client.dashboardWidget.create({
      data: {
        officeId: req.params.officeId,
        title: p.data.title,
        groupBy: p.groupBy,
        chartType: p.data.chartType,
        measure: p.data.measure ?? 'count',
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        createdBy: req.session.userId,
        filterBarangayCode: p.data.filterBarangayCode,
        filterSex: p.data.filterSex,
        filterMonth: p.data.filterMonth,
        filterFieldKey: p.data.filterFieldKey,
        filterFieldValue: p.data.filterFieldValue,
        sources: { create: p.sourceModuleIds.map((moduleId) => ({ moduleId })) },
      },
      select: WIDGET_SELECT,
    });
    await insertAuditLog(client, {
      tableName: 'dashboard_widget',
      recordId: widget.id,
      action: 'insert',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { officeId: req.params.officeId, title: p.data.title, sourceModuleIds: p.sourceModuleIds, chartType: p.data.chartType },
    });
    res.status(201).json({ ...serializeWidget(widget), editable: true });
  }),
);

officeWidgetsRouter.patch(
  '/:officeId/widgets/:id',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    if (!(await loadOwned(client, req, res))) return;
    const p = await parseOfficePayload(client, req, res);
    if (!p) return;
    const widget = await client.$transaction(async (tx) => {
      await tx.dashboardWidgetSource.deleteMany({ where: { widgetId: req.params.id } });
      return tx.dashboardWidget.update({
        where: { id: req.params.id },
        data: {
          title: p.data.title,
          groupBy: p.groupBy,
          chartType: p.data.chartType,
          measure: p.data.measure ?? 'count',
          filterBarangayCode: p.data.filterBarangayCode ?? null,
          filterSex: p.data.filterSex ?? null,
          filterMonth: p.data.filterMonth ?? null,
          filterFieldKey: p.data.filterFieldKey ?? null,
          filterFieldValue: p.data.filterFieldValue ?? null,
          sources: { create: p.sourceModuleIds.map((moduleId) => ({ moduleId })) },
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
      changedFields: { officeId: req.params.officeId, title: p.data.title, sourceModuleIds: p.sourceModuleIds, chartType: p.data.chartType },
    });
    res.json({ ...serializeWidget(widget), editable: true });
  }),
);

officeWidgetsRouter.patch(
  '/:officeId/widgets/:id/dashboard',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const parsed = dashboardToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid payload', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole(req.session.role!);
    if (!(await loadOwned(client, req, res))) return;
    const widget = await client.dashboardWidget.update({ where: { id: req.params.id }, data: { showOnDashboard: parsed.data.showOnDashboard }, select: WIDGET_SELECT });
    await insertAuditLog(client, {
      tableName: 'dashboard_widget',
      recordId: widget.id,
      action: 'update',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: parsed.data,
    });
    res.json({ ...serializeWidget(widget), editable: true });
  }),
);

officeWidgetsRouter.delete(
  '/:officeId/widgets/:id',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const existing = await loadOwned(client, req, res);
    if (!existing) return;
    await client.dashboardWidget.delete({ where: { id: existing.id } });
    await insertAuditLog(client, {
      tableName: 'dashboard_widget',
      recordId: existing.id,
      action: 'delete',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { officeId: req.params.officeId, title: existing.title },
    });
    res.status(204).send();
  }),
);

officeWidgetsRouter.get(
  '/:officeId/widgets/:id/data',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const officeId = req.params.officeId!;
    const w = await client.dashboardWidget.findUnique({ where: { id: req.params.id }, select: { officeId: true, sources: { select: { moduleId: true } } } });
    if (!w || !visibleTo(w, officeId, await officeModuleIds(client, officeId))) {
      sendError(res, 404, 'NOT_FOUND', 'No such chart for this office');
      return;
    }
    res.json(await widgetData(client, req.params.id!));
  }),
);
