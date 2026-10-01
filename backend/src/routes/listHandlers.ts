import type { PrismaClient } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendCsv } from '../lib/csv';
import { sendError } from '../lib/errors';
import { parsePage, type Paginated } from '../lib/pagination';
import { getPrismaForRole } from '../lib/prismaByRole';
import {
  CATEGORIES, listVulnerable, summarize, usesSampleData as disasterUsesSample,
  type Category, type DisasterFilters, type VulnerablePerson,
} from '../services/disasterLists';
import { countGap, listGapPeople, toGapRule, usesSampleData as gapUsesSample, type GapPerson, type GapRule } from '../services/programGaps';

// Program gaps and disaster lists, shared by the admin routes (whole city)
// and the office routes (one office: the gap rules that target its own
// programs; disaster lists for the office that runs Evacuees). Office scope
// is req.params.officeId, already checked by requireOfficeAccess. Every
// people list, print and export is audit-logged with that scope.

const officeOf = (req: Request): string | undefined => req.params.officeId;
const clientFor = (req: Request): PrismaClient => getPrismaForRole(req.session.role!);

async function audit(req: Request, tableName: string, recordId: string | null, changedFields: Record<string, unknown>) {
  await insertAuditLog(clientFor(req), {
    tableName, recordId, action: 'read', actorUserId: req.session.userId, actorRole: req.session.role,
    changedFields: { ...changedFields, officeId: officeOf(req) ?? null },
  });
}

const barangayOf = (req: Request) => (typeof req.query.barangayCode === 'string' && req.query.barangayCode ? req.query.barangayCode : undefined);

// ---------------------------------------------------------------- gaps

const GAP_PAGE_SIZE = 25;

// A rule an office may see: active, and its target program is the office's.
async function loadVisibleRule(req: Request): Promise<GapRule | null> {
  const id = req.params.ruleId;
  if (!id || !z.string().uuid().safeParse(id).success) return null;
  const row = await clientFor(req).programGapRule.findUnique({ where: { id }, include: { targetModule: { select: { officeId: true } } } });
  if (!row) return null;
  const officeId = officeOf(req);
  if (officeId && (!row.isActive || row.targetModule.officeId !== officeId)) return null;
  return toGapRule(row);
}

export const gapSummary: RequestHandler = asyncHandler(async (req, res) => {
  const client = clientFor(req);
  const officeId = officeOf(req);
  const filters = { barangayCode: barangayOf(req) };
  const [rows, modules] = await Promise.all([
    client.programGapRule.findMany({
      where: officeId ? { isActive: true, targetModule: { officeId } } : undefined,
      orderBy: [{ kind: 'desc' }, { createdAt: 'asc' }],
    }),
    client.officeModule.findMany({
      select: { id: true, name: true, office: { select: { id: true, name: true, shortName: true, accentHue: true, icon: true, isActive: true } } },
      orderBy: [{ office: { name: 'asc' } }, { sortOrder: 'asc' }],
    }),
  ]);
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const rules = await Promise.all(
    rows.map(async (row) => {
      const rule = toGapRule(row);
      const [count, sample] = rule.isActive ? await Promise.all([countGap(client, rule, filters), gapUsesSample(client, rule)]) : [null, false];
      const target = moduleById.get(rule.targetModuleId);
      return {
        ...rule,
        targetProgram: target ? { id: target.id, name: target.name, office: target.office } : null,
        sourcePrograms: rule.sourceModuleIds.map((id) => moduleById.get(id)?.name ?? 'Removed program'),
        total: count?.total ?? null,
        byBarangay: count?.byBarangay.slice(0, 5) ?? [],
        usesSampleData: sample,
      };
    }),
  );
  // Only admin edits rules, so only admin needs the program list.
  const programs = officeId ? [] : modules.filter((m) => m.office.isActive).map((m) => ({ id: m.id, name: m.name, officeName: m.office.shortName || m.office.name }));
  res.json({ rules, programs });
});

export const gapPeople: RequestHandler = asyncHandler(async (req, res) => {
  const rule = await loadVisibleRule(req);
  if (!rule) { sendError(res, 404, 'NOT_FOUND', 'No such program gap rule'); return; }
  const client = clientFor(req);
  const filters = { barangayCode: barangayOf(req) };
  const page = parsePage(req.query.page);
  const [{ total }, items] = await Promise.all([
    countGap(client, rule, filters),
    listGapPeople(client, rule, filters, { limit: GAP_PAGE_SIZE, offset: (page - 1) * GAP_PAGE_SIZE }),
  ]);
  await audit(req, 'program_gap_rule', rule.id, { view: 'people', page, barangayCode: filters.barangayCode ?? null, rows: items.length });
  const body: Paginated<GapPerson> = { items, total, page, pageSize: GAP_PAGE_SIZE };
  res.json(body);
});

export const gapCsv: RequestHandler = asyncHandler(async (req, res) => {
  const rule = await loadVisibleRule(req);
  if (!rule) { sendError(res, 404, 'NOT_FOUND', 'No such program gap rule'); return; }
  const filters = { barangayCode: barangayOf(req) };
  const people = await listGapPeople(clientFor(req), rule, filters, null);
  await audit(req, 'program_gap_rule', rule.id, { view: 'export', barangayCode: filters.barangayCode ?? null, rows: people.length });
  sendCsv(
    res,
    `program-gap-${rule.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Name', 'Age', 'Sex', 'Barangay', 'In program(s)', 'Rule'],
    people.map((p) => [p.name, p.age, p.sex, p.barangay, p.sourcePrograms.join('; '), rule.name]),
  );
});

// ---------------------------------------------------------------- disaster lists

// The office that runs Evacuees (CDRRMO) sees disaster lists; admin always.
export const EVACUEES_SLUG = 'evacuees';
export async function officeRunsEvacuees(client: PrismaClient, officeId: string): Promise<boolean> {
  return (await client.officeModule.count({ where: { officeId, slug: EVACUEES_SLUG } })) > 0;
}
export const requireDisasterAccess: RequestHandler = asyncHandler(async (req, res, next) => {
  const officeId = officeOf(req);
  if (officeId && !(await officeRunsEvacuees(clientFor(req), officeId))) {
    sendError(res, 403, 'FORBIDDEN', 'Disaster lists are for the office that runs Evacuees');
    return;
  }
  next();
});

const DISASTER_PAGE_SIZE = 50;
const PRINT_LIMIT = 5000;
const NEED_LABEL: Record<Category, string> = {
  senior: 'Senior (60+)', young_child: 'Child under 5', pwd: 'PWD', pregnant: 'Pregnant', solo_parent: 'Solo parent',
};

function disasterFilters(req: Request): DisasterFilters | null {
  const raw = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
  if (raw && !(CATEGORIES as readonly string[]).includes(raw)) return null;
  return { barangayCode: barangayOf(req), category: raw as Category | undefined };
}
const auditDisaster = (req: Request, view: string, f: DisasterFilters, rows: number) =>
  audit(req, 'Citizen', null, { view: `disaster-list:${view}`, barangayCode: f.barangayCode ?? null, category: f.category ?? null, rows });

export const disasterSummary: RequestHandler = asyncHandler(async (req, res) => {
  const client = clientFor(req);
  const [summary, sample] = await Promise.all([summarize(client, { barangayCode: barangayOf(req) }), disasterUsesSample(client)]);
  res.json({ ...summary, usesSampleData: sample });
});

export const disasterPeople: RequestHandler = asyncHandler(async (req, res) => {
  const f = disasterFilters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown category'); return; }
  const page = parsePage(req.query.page);
  const { total, items } = await listVulnerable(clientFor(req), f, { limit: DISASTER_PAGE_SIZE, offset: (page - 1) * DISASTER_PAGE_SIZE });
  await auditDisaster(req, 'people', f, items.length);
  const body: Paginated<VulnerablePerson> = { items, total, page, pageSize: DISASTER_PAGE_SIZE };
  res.json(body);
});

export const disasterPrint: RequestHandler = asyncHandler(async (req, res) => {
  const f = disasterFilters(req);
  if (!f || !f.barangayCode) { sendError(res, 400, 'VALIDATION_ERROR', 'Choose one barangay to print'); return; }
  const { total, items } = await listVulnerable(clientFor(req), f, { limit: PRINT_LIMIT, offset: 0 });
  await auditDisaster(req, 'print', f, items.length);
  res.json({ total, items, truncated: total > items.length });
});

export const disasterCsv: RequestHandler = asyncHandler(async (req, res) => {
  const f = disasterFilters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown category'); return; }
  const { items } = await listVulnerable(clientFor(req), f, null);
  await auditDisaster(req, 'export', f, items.length);
  const scope = [items[0] && f.barangayCode ? items[0].barangay : 'all-barangays', f.category].filter(Boolean).join('-');
  sendCsv(
    res,
    `disaster-list-${String(scope).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Barangay', 'Household head', 'Name', 'Age', 'Sex', 'Street', 'Needs', 'Evacuation center now'],
    items.map((p) => [
      p.barangay, p.householdHead, p.name, p.age, p.sex, p.street,
      p.needs.map((n) => (n === 'pregnant' && p.pregnancyNeedsCheck ? 'Pregnant (check record)' : NEED_LABEL[n])).join('; '),
      p.evacuationCenter,
    ]),
  );
});
