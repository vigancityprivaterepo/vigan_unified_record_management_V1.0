import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireOfficeAccess } from '../middleware/auth';
import { MAX_ROWS_PER_REQUEST, runImport } from '../services/officeImport';

// Bulk import into one of an office's programs (see services/officeImport.ts).
// The browser sends rows in chunks of up to MAX_ROWS_PER_REQUEST, first with
// dryRun (check) and then without (import), reusing one batchId for every
// chunk of the same file. requireOfficeAccess keeps staff to their office.
export const officeImportRouter = Router();

const cell = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));
const bodySchema = z.object({
  dryRun: z.boolean(),
  batchId: z.string().uuid().optional(),
  fileName: z.string().trim().max(200).optional(),
  rows: z.array(z.object({ core: z.record(cell).optional(), fields: z.record(cell).optional() })).min(1).max(MAX_ROWS_PER_REQUEST),
});

officeImportRouter.post(
  '/:officeId/modules/:moduleId/import',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const module = await client.officeModule.findUnique({ where: { id: req.params.moduleId } });
    const office = module ? await client.office.findUnique({ where: { id: module.officeId }, select: { isActive: true } }) : null;
    if (!module || module.officeId !== req.params.officeId || !office?.isActive) {
      sendError(res, 404, 'NOT_FOUND', 'No such module');
      return;
    }
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', `Send between 1 and ${MAX_ROWS_PER_REQUEST} rows`, parsed.error.flatten());
      return;
    }
    const { dryRun, batchId, fileName, rows } = parsed.data;
    const result = await runImport(client, module, rows, { dryRun, batchId, actor: { userId: req.session.userId!, role: req.session.role! } });
    if (!dryRun) {
      const count = (o: string) => result.results.filter((r) => r.outcome === o).length;
      await insertAuditLog(client, {
        tableName: 'office_module',
        recordId: module.id,
        action: 'insert',
        actorUserId: req.session.userId,
        actorRole: req.session.role,
        changedFields: {
          event: 'bulk_import', batchId: result.batchId, fileName: fileName ?? null, rows: rows.length,
          linked: count('linked'), created: count('created'), record: count('record'), review: count('review'),
          invalid: count('invalid'), alreadyReceived: count('already_received'), failed: count('failed'),
        },
      });
    }
    res.json(result);
  }),
);
