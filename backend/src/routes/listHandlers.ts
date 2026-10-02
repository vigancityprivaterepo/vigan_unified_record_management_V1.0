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
  CATEGORIES, listVulnerable, reliefEvents, summarize, usesSampleData as disasterUsesSample,
  type Category, type DisasterFilters, type VulnerablePerson,
} from '../services/disasterLists';
import { BUSINESS_PERMITS_SLUG, listRenewals, summarizeRenewals, type RenewalBusiness, type RenewalFilters } from '../services/businessRenewals';
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
  await audit(req, 'program_gap_rule', rule.id, { view: 'people', page, barangayCode: filters.barangayCode ?? null, rows: items.length, personKeys: items.map((p) => p.personKey) });
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

// A list belongs to the office that runs a given program: disaster lists to
// the office that runs Evacuees (CDRRMO), business renewals to the office
// that runs Business Permits (BPLO). Admin always passes.
export const EVACUEES_SLUG = 'evacuees';
export async function officeRunsModule(client: PrismaClient, officeId: string, slug: string): Promise<boolean> {
  return (await client.officeModule.count({ where: { officeId, slug } })) > 0;
}
function requireRunsModule(slug: string, message: string): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const officeId = officeOf(req);
    if (officeId && !(await officeRunsModule(clientFor(req), officeId, slug))) {
      sendError(res, 403, 'FORBIDDEN', message);
      return;
    }
    next();
  });
}
export const requireDisasterAccess = requireRunsModule(EVACUEES_SLUG, 'Disaster lists are for the office that runs Evacuees');
export const requireRenewalsAccess = requireRunsModule(BUSINESS_PERMITS_SLUG, 'Business renewals are for the office that runs Business Permits');

const DISASTER_PAGE_SIZE = 50;
const PRINT_LIMIT = 5000;
const NEED_LABEL: Record<Category, string> = {
  senior: 'Senior (60+)', young_child: 'Child under 5', pwd: 'PWD', pregnant: 'Pregnant', solo_parent: 'Solo parent',
};

function disasterFilters(req: Request): DisasterFilters | null {
  const raw = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
  if (raw && !(CATEGORIES as readonly string[]).includes(raw)) return null;
  const event = typeof req.query.event === 'string' && req.query.event.trim() ? req.query.event.slice(0, 200) : undefined;
  const relief = req.query.relief === 'received' || req.query.relief === 'not_received' ? req.query.relief : undefined;
  return { barangayCode: barangayOf(req), category: raw as Category | undefined, event, relief };
}
const auditDisaster = (req: Request, view: string, f: DisasterFilters, rows: number, personKeys?: string[]) =>
  audit(req, 'Citizen', null, { view: `disaster-list:${view}`, barangayCode: f.barangayCode ?? null, category: f.category ?? null, event: f.event ?? null, relief: f.relief ?? null, rows, ...(personKeys ? { personKeys } : {}) });

export const disasterSummary: RequestHandler = asyncHandler(async (req, res) => {
  const f = disasterFilters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown category'); return; }
  const client = clientFor(req);
  const [summary, sample, events] = await Promise.all([
    summarize(client, { barangayCode: f.barangayCode, event: f.event }), disasterUsesSample(client), reliefEvents(client),
  ]);
  res.json({ ...summary, usesSampleData: sample, reliefEvents: events });
});

export const disasterPeople: RequestHandler = asyncHandler(async (req, res) => {
  const f = disasterFilters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown category'); return; }
  const page = parsePage(req.query.page);
  const { total, items } = await listVulnerable(clientFor(req), f, { limit: DISASTER_PAGE_SIZE, offset: (page - 1) * DISASTER_PAGE_SIZE });
  await auditDisaster(req, 'people', f, items.length, items.map((p) => p.personKey));
  const body: Paginated<VulnerablePerson> = { items, total, page, pageSize: DISASTER_PAGE_SIZE };
  res.json(body);
});

export const disasterPrint: RequestHandler = asyncHandler(async (req, res) => {
  const f = disasterFilters(req);
  if (!f || !f.barangayCode) { sendError(res, 400, 'VALIDATION_ERROR', 'Choose one barangay to print'); return; }
  const { total, items } = await listVulnerable(clientFor(req), f, { limit: PRINT_LIMIT, offset: 0 });
  await auditDisaster(req, 'print', f, items.length, items.map((p) => p.personKey));
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
    ['Barangay', 'Household head', 'Name', 'Age', 'Sex', 'Street', 'Needs', 'Evacuation center now', ...(f.event ? [`Relief received (${f.event})`] : [])],
    items.map((p) => [
      p.barangay, p.householdHead, p.name, p.age, p.sex, p.street,
      p.needs.map((n) => (n === 'pregnant' && p.pregnancyNeedsCheck ? 'Pregnant (check record)' : NEED_LABEL[n])).join('; '),
      p.evacuationCenter,
      ...(f.event ? [p.reliefReceived ? 'Yes' : 'No'] : []),
    ]),
  );
});

// ---------------------------------------------------------------- business renewals

const RENEWAL_PAGE_SIZE = 50;

function renewalFilters(req: Request): RenewalFilters | null {
  const str = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? (req.query[k] as string) : undefined);
  const rawYear = str('lastYear');
  let lastYear: RenewalFilters['lastYear'];
  if (rawYear === 'none') lastYear = 'none';
  else if (rawYear !== undefined) {
    if (!/^\d{4}$/.test(rawYear)) return null;
    lastYear = Number(rawYear);
  }
  const q = str('q');
  return { lastYear, barangay: str('barangay'), line: str('line'), statusCode: str('statusCode'), q: q && q.length <= 100 ? q : undefined };
}
const auditRenewals = (req: Request, view: string, f: RenewalFilters, rows: number) =>
  audit(req, 'office_record', null, { view: `business-renewals:${view}`, filters: f, rows });

export const renewalsSummary: RequestHandler = asyncHandler(async (req, res) => {
  res.json(await summarizeRenewals(clientFor(req)));
});

export const renewalsList: RequestHandler = asyncHandler(async (req, res) => {
  const f = renewalFilters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', 'lastYear must be a year or "none"'); return; }
  const page = parsePage(req.query.page);
  const { total, items } = await listRenewals(clientFor(req), f, { limit: RENEWAL_PAGE_SIZE, offset: (page - 1) * RENEWAL_PAGE_SIZE });
  await auditRenewals(req, 'list', f, items.length);
  const body: Paginated<RenewalBusiness> = { items, total, page, pageSize: RENEWAL_PAGE_SIZE };
  res.json(body);
});

export const renewalsCsv: RequestHandler = asyncHandler(async (req, res) => {
  const f = renewalFilters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', 'lastYear must be a year or "none"'); return; }
  const { items } = await listRenewals(clientFor(req), f, null);
  await auditRenewals(req, 'export', f, items.length);
  const scope = [f.lastYear === 'none' ? 'no-permit-year' : f.lastYear ? `last-permit-${f.lastYear}` : 'all', f.barangay].filter(Boolean).join('-');
  sendCsv(
    res,
    `business-renewals-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Business name', 'Trade name', 'TAN', 'Line of business', 'Barangay', 'Last permit year', 'Valid until', 'Permit no.', 'BPLS status code'],
    items.map((b) => [b.businessName, b.tradeName, b.tan, b.line, b.barangay, b.lastYear, b.validUntil, b.permitNo, b.statusCode]),
  );
});
