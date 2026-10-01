import { Router, type Request } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendCsv } from '../lib/csv';
import { sendError } from '../lib/errors';
import { parsePage, type Paginated } from '../lib/pagination';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { CATEGORIES, listVulnerable, summarize, usesSampleData, type Category, type DisasterFilters, type VulnerablePerson } from '../services/disasterLists';

// Disaster lists (see services/disasterLists.ts). Admin only for now: the
// lists show disability and pregnancy, which are sensitive personal
// information, so every list view, print and export is audit-logged.
export const adminDisasterListsRouter = Router();
adminDisasterListsRouter.use(requireRole('admin'));

const PAGE_SIZE = 50;
// A printed sheet is one barangay; this only guards against a runaway query.
const PRINT_LIMIT = 5000;

const NEED_LABEL: Record<Category, string> = {
  senior: 'Senior (60+)', young_child: 'Child under 5', pwd: 'PWD', pregnant: 'Pregnant', solo_parent: 'Solo parent',
};

function filtersOf(req: Request): DisasterFilters | null {
  const barangayCode = typeof req.query.barangayCode === 'string' && req.query.barangayCode ? req.query.barangayCode : undefined;
  const raw = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
  if (raw && !(CATEGORIES as readonly string[]).includes(raw)) return null;
  return { barangayCode, category: raw as Category | undefined };
}

async function audit(req: Request, view: string, filters: DisasterFilters, rows: number) {
  await insertAuditLog(getPrismaForRole('admin'), {
    tableName: 'Citizen',
    recordId: null,
    action: 'read',
    actorUserId: req.session.userId,
    actorRole: req.session.role,
    changedFields: { view: `disaster-list:${view}`, barangayCode: filters.barangayCode ?? null, category: filters.category ?? null, rows },
  });
}

adminDisasterListsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = filtersOf(req);
    if (!filters) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown category'); return; }
    const client = getPrismaForRole('admin');
    const [summary, sample] = await Promise.all([summarize(client, { barangayCode: filters.barangayCode }), usesSampleData(client)]);
    res.json({ ...summary, usesSampleData: sample });
  }),
);

adminDisasterListsRouter.get(
  '/people',
  asyncHandler(async (req, res) => {
    const filters = filtersOf(req);
    if (!filters) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown category'); return; }
    const page = parsePage(req.query.page);
    const { total, items } = await listVulnerable(getPrismaForRole('admin'), filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    await audit(req, 'people', filters, items.length);
    const body: Paginated<VulnerablePerson> = { items, total, page, pageSize: PAGE_SIZE };
    res.json(body);
  }),
);

// Whole list for one barangay, for the printed sheet.
adminDisasterListsRouter.get(
  '/print',
  asyncHandler(async (req, res) => {
    const filters = filtersOf(req);
    if (!filters || !filters.barangayCode) { sendError(res, 400, 'VALIDATION_ERROR', 'Choose one barangay to print'); return; }
    const { total, items } = await listVulnerable(getPrismaForRole('admin'), filters, { limit: PRINT_LIMIT, offset: 0 });
    await audit(req, 'print', filters, items.length);
    res.json({ total, items, truncated: total > items.length });
  }),
);

adminDisasterListsRouter.get(
  '/people.csv',
  asyncHandler(async (req, res) => {
    const filters = filtersOf(req);
    if (!filters) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown category'); return; }
    const { items } = await listVulnerable(getPrismaForRole('admin'), filters, null);
    await audit(req, 'export', filters, items.length);
    const date = new Date().toISOString().slice(0, 10);
    const scope = [items[0] && filters.barangayCode ? items[0].barangay : 'all-barangays', filters.category].filter(Boolean).join('-');
    sendCsv(
      res,
      `disaster-list-${String(scope).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}.csv`,
      ['Barangay', 'Household head', 'Name', 'Age', 'Sex', 'Street', 'Needs', 'Evacuation center now'],
      items.map((p) => [p.barangay, p.householdHead, p.name, p.age, p.sex, p.street, p.needs.map((n) => (n === 'pregnant' && p.pregnancyNeedsCheck ? 'Pregnant (check record)' : NEED_LABEL[n])).join('; '), p.evacuationCenter]),
    );
  }),
);
