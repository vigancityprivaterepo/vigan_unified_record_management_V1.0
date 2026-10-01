import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 doesn't catch a rejected promise thrown inside an async route
// handler -- it becomes an unhandled promise rejection, which crashes the
// entire Node process (not just the one request) since there's no global
// handler for it either. Caught the hard way: a missing DB grant on one
// admin route (office_module delete) took the whole backend down for
// every office, not just that request -- see migration
// 20260827180000_grant_admin_delete_on_office_tables's comment. Wrapping a
// handler in this forwards its rejection to Express's own error-handling
// middleware (app.ts's catch-all) instead, which returns a normal 500.
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req as Req, res, next).catch(next);
  };
}
