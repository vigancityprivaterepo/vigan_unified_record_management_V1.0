import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { renewalsCsv, renewalsList, renewalsSummary } from './listHandlers';

// Business renewals (see services/businessRenewals.ts), admin view. The
// handlers are shared with the office that runs Business Permits (BPLO).
export const adminBusinessRenewalsRouter = Router();
adminBusinessRenewalsRouter.use(requireRole('admin'));

adminBusinessRenewalsRouter.get('/', renewalsSummary);
adminBusinessRenewalsRouter.get('/list', renewalsList);
adminBusinessRenewalsRouter.get('/list.csv', renewalsCsv);
