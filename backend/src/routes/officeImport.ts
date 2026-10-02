import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireOfficeAccess } from '../middleware/auth';
import { MAX_ROWS_PER_REQUEST, runImport } from '../services/officeImport';
import { linkCandidates, linkRecord, linkSure } from '../services/registryLinking';
import { parsePage } from '../lib/pagination';
import type { Request, Response } from 'express';

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

// Linking saved records to the registry (services/registryLinking.ts), for
// programs where the link is optional. Admin may look; only the office's
// own staff link (admin's view of office data is read-only).
const LINK_PAGE = 25;

async function linkableModule(req: Request, res: Response) {
  const client = getPrismaForRole(req.session.role!);
  const module = await client.officeModule.findUnique({ where: { id: req.params.moduleId } });
  if (!module || module.officeId !== req.params.officeId) {
    sendError(res, 404, 'NOT_FOUND', 'No such module');
    return null;
  }
  if (!module.collectPersonInfo || module.requiresCitizenLink) {
    sendError(res, 400, 'NOT_LINKABLE', 'Records in this program are always linked when saved, or are not about a person');
    return null;
  }
  return { client, module };
}
function staffOnly(req: Request, res: Response): boolean {
  if (req.session.role === 'office_staff') return true;
  sendError(res, 403, 'FORBIDDEN', "Only the office's own staff can link its records");
  return false;
}

officeImportRouter.get(
  '/:officeId/modules/:moduleId/registry-links',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const m = await linkableModule(req, res);
    if (!m) return;
    const page = parsePage(req.query.page);
    const result = await linkCandidates(m.client, m.module.id, { limit: LINK_PAGE, offset: (page - 1) * LINK_PAGE });
    res.json({ ...result, page, pageSize: LINK_PAGE });
  }),
);

officeImportRouter.post(
  '/:officeId/modules/:moduleId/registry-links',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    if (!staffOnly(req, res)) return;
    const m = await linkableModule(req, res);
    if (!m) return;
    const parsed = z.object({ recordId: z.string().uuid(), personKey: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) { sendError(res, 400, 'VALIDATION_ERROR', 'recordId and personKey are required'); return; }
    const r = await linkRecord(m.client, m.module.id, parsed.data.recordId, parsed.data.personKey, { userId: req.session.userId!, role: req.session.role! });
    if (!r.ok) { sendError(res, r.status, r.status === 409 ? 'ALREADY_LINKED' : 'NOT_FOUND', r.message); return; }
    res.json({ linked: 1 });
  }),
);

officeImportRouter.post(
  '/:officeId/modules/:moduleId/registry-links/sure',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    if (!staffOnly(req, res)) return;
    const m = await linkableModule(req, res);
    if (!m) return;
    res.json(await linkSure(m.client, m.module.id, { userId: req.session.userId!, role: req.session.role! }));
  }),
);
