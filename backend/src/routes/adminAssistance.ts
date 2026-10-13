import { Router, type Request } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendCsv } from '../lib/csv';
import { sendError } from '../lib/errors';
import { parsePage, type Paginated } from '../lib/pagination';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { listAssistedHouseholds, summarizeAssistance, TIMES, type AssistanceFilters, type AssistedHousehold, type Times } from '../services/assistance';

// Assistance across offices (see services/assistance.ts). The summary is
// counts only, so a view-only account may open it (middleware/auth.ts); the
// household list names people and is for the administrator.
export const adminAssistanceRouter = Router();
adminAssistanceRouter.use(requireRole('admin'));

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 20000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Defaults to the last 12 months, ending today.
function filters(req: Request): AssistanceFilters | null {
  const str = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? (req.query[k] as string) : undefined);
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  yearAgo.setDate(yearAgo.getDate() + 1);
  const from = str('from') ?? iso(yearAgo);
  const to = str('to') ?? iso(today);
  const valid = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(d));
  if (!valid(from) || !valid(to) || from > to) return null;
  const times = str('times');
  if (times && !(TIMES as readonly string[]).includes(times)) return null;
  return { from, to, barangayCode: str('barangayCode'), times: times as Times | undefined };
}
const BAD_FILTERS = 'from and to must be dates (YYYY-MM-DD), from not after to; times must be never, once, few or many';

adminAssistanceRouter.get('/', asyncHandler(async (req, res) => {
  const f = filters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', BAD_FILTERS); return; }
  res.json({ from: f.from, to: f.to, ...(await summarizeAssistance(getPrismaForRole('admin'), f)) });
}));

const audit = (req: Request, view: string, f: AssistanceFilters, items: AssistedHousehold[]) =>
  insertAuditLog(getPrismaForRole('admin'), {
    tableName: 'Citizen', recordId: null, action: 'read', actorUserId: req.session.userId, actorRole: req.session.role,
    changedFields: { view: `assistance:${view}`, filters: f, rows: items.length, personKeys: items.map((h) => h.headKey) },
  });

adminAssistanceRouter.get('/list', asyncHandler(async (req, res) => {
  const f = filters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', BAD_FILTERS); return; }
  const page = parsePage(req.query.page);
  const { total, items } = await listAssistedHouseholds(getPrismaForRole('admin'), f, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  await audit(req, 'list', f, items);
  const body: Paginated<AssistedHousehold> = { items, total, page, pageSize: PAGE_SIZE };
  res.json(body);
}));

adminAssistanceRouter.get('/list.csv', asyncHandler(async (req, res) => {
  const f = filters(req);
  if (!f) { sendError(res, 400, 'VALIDATION_ERROR', BAD_FILTERS); return; }
  const { items } = await listAssistedHouseholds(getPrismaForRole('admin'), f, { limit: EXPORT_LIMIT, offset: 0 });
  await audit(req, 'export', f, items);
  sendCsv(
    res,
    `assistance-households-${f.from}-to-${f.to}.csv`,
    ['Household head', 'Barangay', 'Members', 'Times assisted', 'Value (PHP)', 'Programs', 'Last assisted'],
    items.map((h) => [h.head, h.barangay, h.members, h.releases, h.value, h.programs, h.lastOn]),
  );
}));
