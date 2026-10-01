import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { disasterCsv, disasterPeople, disasterPrint, disasterSummary } from './listHandlers';

// Disaster lists (see services/disasterLists.ts), whole city. The handlers
// are shared with the office that runs Evacuees (routes/officeLists.ts).
export const adminDisasterListsRouter = Router();
adminDisasterListsRouter.use(requireRole('admin'));

adminDisasterListsRouter.get('/', disasterSummary);
adminDisasterListsRouter.get('/people', disasterPeople);
adminDisasterListsRouter.get('/print', disasterPrint);
adminDisasterListsRouter.get('/people.csv', disasterCsv);
