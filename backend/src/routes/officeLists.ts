import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireOfficeAccess } from '../middleware/auth';
import {
  disasterCsv, disasterPeople, disasterPrint, disasterSummary, EVACUEES_SLUG, gapCsv, gapPeople, gapSummary, officeRunsModule,
  renewalsCsv, renewalsList, renewalsSummary, requireDisasterAccess, requireRenewalsAccess,
} from './listHandlers';
import { BUSINESS_PERMITS_SLUG } from '../services/businessRenewals';
import { officeTodo } from '../services/officeTodo';
import { recordReliefForPerson, RELIEF_SLUG } from '../services/reliefClaims';
import { sendError } from '../lib/errors';

// An office's own lists (owner decision, 2026-10-01: offices see these for
// their own programs):
//  - Program gaps: active rules whose target program belongs to the office.
//    Read-only; rules are managed by admin.
//  - Disaster lists: whole city, for the office that runs Evacuees (CDRRMO).
//  - Business renewals: for the office that runs Business Permits (BPLO).
// requireOfficeAccess keeps office_staff to their own :officeId.
export const officeListsRouter = Router();

// What the office sidebar should show.
officeListsRouter.get(
  '/:officeId/lists',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const officeId = req.params.officeId!;
    const [gapRules, disaster, renewals] = await Promise.all([
      client.programGapRule.count({ where: { isActive: true, targetModule: { officeId } } }),
      officeRunsModule(client, officeId, EVACUEES_SLUG),
      officeRunsModule(client, officeId, BUSINESS_PERMITS_SLUG),
    ]);
    res.json({ programGaps: gapRules, disasterLists: disaster, businessRenewals: renewals });
  }),
);

officeListsRouter.get('/:officeId/program-gaps', requireOfficeAccess, gapSummary);
officeListsRouter.get('/:officeId/program-gaps/:ruleId/people', requireOfficeAccess, gapPeople);
officeListsRouter.get('/:officeId/program-gaps/:ruleId/people.csv', requireOfficeAccess, gapCsv);

officeListsRouter.get('/:officeId/disaster-lists', requireOfficeAccess, requireDisasterAccess, disasterSummary);
officeListsRouter.get('/:officeId/disaster-lists/people', requireOfficeAccess, requireDisasterAccess, disasterPeople);
officeListsRouter.get('/:officeId/disaster-lists/print', requireOfficeAccess, requireDisasterAccess, disasterPrint);
officeListsRouter.get('/:officeId/disaster-lists/people.csv', requireOfficeAccess, requireDisasterAccess, disasterCsv);

officeListsRouter.get('/:officeId/business-renewals', requireOfficeAccess, requireRenewalsAccess, renewalsSummary);
officeListsRouter.get('/:officeId/business-renewals/list', requireOfficeAccess, requireRenewalsAccess, renewalsList);
officeListsRouter.get('/:officeId/business-renewals/list.csv', requireOfficeAccess, requireRenewalsAccess, renewalsCsv);

// Recording relief from the Disaster lists: the office's Relief
// Distribution form (null when the office has none), and "Mark as received"
// for one citizen on the list.
officeListsRouter.get('/:officeId/disaster-lists/relief-form', requireOfficeAccess, requireDisasterAccess, asyncHandler(async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const module = await client.officeModule.findFirst({ where: { officeId: req.params.officeId!, slug: RELIEF_SLUG }, select: { id: true, name: true } });
  if (!module) { res.json(null); return; }
  const fields = await client.officeFormField.findMany({
    where: { moduleId: module.id, NOT: { fieldType: 'FILE' } },
    select: { id: true, key: true, label: true, fieldType: true, options: true, isRequired: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ moduleId: module.id, name: module.name, fields });
}));

officeListsRouter.post('/:officeId/disaster-lists/relief', requireOfficeAccess, requireDisasterAccess, asyncHandler(async (req, res) => {
  const personKey = typeof req.body?.personKey === 'string' ? req.body.personKey : '';
  if (!/^[0-9a-f-]{36}$/i.test(personKey)) { sendError(res, 400, 'VALIDATION_ERROR', 'personKey is required'); return; }
  const result = await recordReliefForPerson(getPrismaForRole(req.session.role!), req.params.officeId!, personKey, req.body.fields ?? {}, {
    userId: req.session.userId!, role: req.session.role!,
  });
  if (!result.ok) { sendError(res, result.status, result.code, result.message, result.details); return; }
  res.status(201).json({ recordId: result.recordId });
}));

// The office's to-do list for its Home page (counts only, no names).
officeListsRouter.get('/:officeId/todo', requireOfficeAccess, asyncHandler(async (req, res) => {
  res.json(await officeTodo(getPrismaForRole(req.session.role!), req.params.officeId!));
}));
