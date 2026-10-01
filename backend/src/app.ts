import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { env } from './env';
import { UploadValidationError } from './lib/documentUpload';
import { sendError } from './lib/errors';
import { createSessionMiddleware } from './lib/session';
import { adminDashboardRouter } from './routes/adminDashboard';
import { officeWidgetsRouter } from './routes/officeWidgets';
import { adminBusinessRenewalsRouter } from './routes/adminBusinessRenewals';
import { adminDashboardWidgetsRouter } from './routes/adminDashboardWidgets';
import { adminDisasterListsRouter } from './routes/adminDisasterLists';
import { adminInsightsRouter } from './routes/adminInsights';
import { adminOfficesRouter } from './routes/adminOffices';
import { adminProgramGapsRouter } from './routes/adminProgramGaps';
import { adminReviewRouter } from './routes/adminReview';
import { adminSettingsRouter } from './routes/adminSettings';
import { adminUsersRouter } from './routes/adminUsers';
import { createAuthRouter, type LoginRateLimitOptions } from './routes/auth';
import { barangaysRouter } from './routes/barangays';
import { officeRouter } from './routes/office';
import { officeListsRouter } from './routes/officeLists';

// Factory rather than a module-level app instance so tests can build an app
// with a short session idle timeout without touching global env state.
export function createApp(options?: {
  sessionIdleTimeoutMs?: number;
  loginRateLimit?: LoginRateLimitOptions;
}): Application {
  const app = express();

  // Frontend and backend are different origins (different ports) even in
  // local dev -- credentialed (cookie-bearing) fetches need explicit CORS,
  // "*" isn't allowed together with credentials: true.
  // exposedHeaders: lets the browser read the export file name across the
  // frontend/backend origins (otherwise every CSV saves under a fallback name).
  app.use(cors({ origin: env.corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json());
  app.use(createSessionMiddleware(options?.sessionIdleTimeoutMs));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vigan-ucrms-backend', phase: 8 });
  });

  app.use('/auth', createAuthRouter({ loginRateLimit: options?.loginRateLimit }));
  app.use('/barangays', barangaysRouter);
  app.use('/offices', officeWidgetsRouter);
  app.use('/offices', officeListsRouter);
  app.use('/offices', officeRouter);
  app.use('/admin/duplicate-review-queue', adminReviewRouter);
  app.use('/admin/staff-accounts', adminUsersRouter);
  app.use('/admin/settings', adminSettingsRouter);
  app.use('/admin/offices', adminOfficesRouter);
  app.use('/admin/dashboard/widgets', adminDashboardWidgetsRouter);
  app.use('/admin/insights', adminInsightsRouter);
  app.use('/admin/program-gaps', adminProgramGapsRouter);
  app.use('/admin/disaster-lists', adminDisasterListsRouter);
  app.use('/admin/business-renewals', adminBusinessRenewalsRouter);
  app.use('/admin', adminDashboardRouter);

  // multer's file-size-limit and fileFilter rejections arrive here (they
  // reject before the route handler runs, so a route's own try/catch never
  // sees them) -- without this they'd fall through to Express's default
  // HTML error page instead of the standard JSON error shape. Narrowly
  // scoped to multer/upload errors specifically, not a catch-all for any
  // Error -- an unrelated bug elsewhere should still surface as a real 500,
  // not get mislabeled as an upload problem.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError || err instanceof UploadValidationError) {
      sendError(res, 400, 'UPLOAD_ERROR', err.message);
      return;
    }
    next(err);
  });

  // Final catch-all -- any route wrapped in asyncHandler() that throws
  // (a bad query, a missing grant, whatever) lands here as a normal JSON
  // 500 instead of an unhandled rejection that crashes the whole process.
  // A route NOT wrapped in asyncHandler still bypasses this middleware
  // entirely (its rejection never reaches Express at all), so this is a
  // net, not a guarantee -- see asyncHandler.ts's comment.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
  });

  return app;
}
