import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { accessHistory, accessReport } from '../services/privacy';

// Privacy tools (RA 10173), admin only: a citizen's access history, the
// monthly access report, and the data subject request log. See
// services/privacy.ts for what the history can and cannot show.
export const adminPrivacyRouter = Router();
adminPrivacyRouter.use(requireRole('admin'));

adminPrivacyRouter.get(
  '/people/:personKey/access',
  asyncHandler(async (req, res) => {
    const personKey = req.params.personKey;
    if (!personKey || !z.string().uuid().safeParse(personKey).success) { sendError(res, 404, 'NOT_FOUND', 'No such citizen'); return; }
    res.json({ entries: await accessHistory(getPrismaForRole('admin'), personKey) });
  }),
);

adminPrivacyRouter.get(
  '/access',
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)
      ? req.query.month
      : new Date().toISOString().slice(0, 7);
    res.json(await accessReport(getPrismaForRole('admin'), month));
  }),
);

// ---------------------------------------------------------------- data requests

const KINDS = ['access', 'correction', 'erasure', 'objection', 'other'] as const;
const STATUSES = ['open', 'done', 'declined'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');

const createSchema = z.object({
  requesterName: z.string().trim().min(2).max(200),
  personKey: z.string().uuid().nullable().optional(),
  contact: z.string().trim().max(200).nullable().optional(),
  kind: z.enum(KINDS),
  details: z.string().trim().max(2000).nullable().optional(),
  receivedOn: day,
});
const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  response: z.string().trim().max(2000).nullable().optional(),
  closedOn: day.nullable().optional(),
  details: z.string().trim().max(2000).nullable().optional(),
  contact: z.string().trim().max(200).nullable().optional(),
});

const SELECT = {
  id: true, personKey: true, requesterName: true, contact: true, kind: true, details: true, receivedOn: true,
  status: true, response: true, closedOn: true, createdAt: true, updatedAt: true,
} as const;

const asDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const serialize = (r: { receivedOn: Date; closedOn: Date | null } & Record<string, unknown>) => ({ ...r, receivedOn: asDay(r.receivedOn), closedOn: asDay(r.closedOn) });

adminPrivacyRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' && (STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : undefined;
    const personKey = typeof req.query.personKey === 'string' && z.string().uuid().safeParse(req.query.personKey).success ? req.query.personKey : undefined;
    const rows = await getPrismaForRole('admin').dataRequest.findMany({
      where: { ...(status ? { status } : {}), ...(personKey ? { personKey } : {}) },
      select: SELECT,
      orderBy: [{ status: 'asc' }, { receivedOn: 'desc' }],
      take: 500,
    });
    res.json(rows.map(serialize));
  }),
);

adminPrivacyRouter.post(
  '/requests',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request', parsed.error.flatten()); return; }
    const d = parsed.data;
    const client = getPrismaForRole('admin');
    if (d.personKey && !(await client.citizen.findUnique({ where: { personKey: d.personKey }, select: { personKey: true } }))) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Unknown citizen');
      return;
    }
    const created = await client.dataRequest.create({
      data: {
        requesterName: d.requesterName, personKey: d.personKey ?? null, contact: d.contact ?? null, kind: d.kind, details: d.details ?? null,
        receivedOn: new Date(`${d.receivedOn}T00:00:00Z`), createdBy: req.session.userId, updatedBy: req.session.userId,
      },
      select: SELECT,
    });
    await insertAuditLog(client, { tableName: 'data_request', recordId: created.id, action: 'insert', actorUserId: req.session.userId, actorRole: req.session.role, changedFields: { kind: d.kind, personKey: d.personKey ?? null } });
    res.status(201).json(serialize(created));
  }),
);

adminPrivacyRouter.patch(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, 400, 'VALIDATION_ERROR', 'Invalid update', parsed.error.flatten()); return; }
    const client = getPrismaForRole('admin');
    const existing = id && z.string().uuid().safeParse(id).success ? await client.dataRequest.findUnique({ where: { id }, select: SELECT }) : null;
    if (!existing) { sendError(res, 404, 'NOT_FOUND', 'No such request'); return; }
    const d = parsed.data;
    const status = d.status ?? existing.status;
    // Closing a request needs a date; reopening clears it.
    const closedOn = status === 'open' ? null : d.closedOn !== undefined ? d.closedOn : asDay(existing.closedOn) ?? new Date().toISOString().slice(0, 10);
    const updated = await client.dataRequest.update({
      where: { id: existing.id },
      data: {
        status,
        ...(d.response !== undefined ? { response: d.response } : {}),
        ...(d.details !== undefined ? { details: d.details } : {}),
        ...(d.contact !== undefined ? { contact: d.contact } : {}),
        closedOn: closedOn ? new Date(`${closedOn}T00:00:00Z`) : null,
        updatedBy: req.session.userId,
      },
      select: SELECT,
    });
    await insertAuditLog(client, { tableName: 'data_request', recordId: existing.id, action: 'update', actorUserId: req.session.userId, actorRole: req.session.role, changedFields: { status, closedOn } });
    res.json(serialize(updated));
  }),
);
