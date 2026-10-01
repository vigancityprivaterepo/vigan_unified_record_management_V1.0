import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireOfficeAccess } from '../middleware/auth';
import {
  disasterCsv, disasterPeople, disasterPrint, disasterSummary, gapCsv, gapPeople, gapSummary, officeRunsEvacuees, requireDisasterAccess,
} from './listHandlers';

// An office's own lists (owner decision, 2026-10-01: offices see these for
// their own programs):
//  - Program gaps: active rules whose target program belongs to the office.
//    Read-only; rules are managed by admin.
//  - Disaster lists: whole city, for the office that runs Evacuees (CDRRMO).
// requireOfficeAccess keeps office_staff to their own :officeId.
export const officeListsRouter = Router();

// What the office sidebar should show.
officeListsRouter.get(
  '/:officeId/lists',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const officeId = req.params.officeId!;
    const [gapRules, disaster] = await Promise.all([
      client.programGapRule.count({ where: { isActive: true, targetModule: { officeId } } }),
      officeRunsEvacuees(client, officeId),
    ]);
    res.json({ programGaps: gapRules, disasterLists: disaster });
  }),
);

officeListsRouter.get('/:officeId/program-gaps', requireOfficeAccess, gapSummary);
officeListsRouter.get('/:officeId/program-gaps/:ruleId/people', requireOfficeAccess, gapPeople);
officeListsRouter.get('/:officeId/program-gaps/:ruleId/people.csv', requireOfficeAccess, gapCsv);

officeListsRouter.get('/:officeId/disaster-lists', requireOfficeAccess, requireDisasterAccess, disasterSummary);
officeListsRouter.get('/:officeId/disaster-lists/people', requireOfficeAccess, requireDisasterAccess, disasterPeople);
officeListsRouter.get('/:officeId/disaster-lists/print', requireOfficeAccess, requireDisasterAccess, disasterPrint);
officeListsRouter.get('/:officeId/disaster-lists/people.csv', requireOfficeAccess, requireDisasterAccess, disasterCsv);
