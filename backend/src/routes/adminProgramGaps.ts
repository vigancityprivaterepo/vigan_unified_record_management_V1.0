import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { toGapRule, type GapRule } from '../services/programGaps';
import { gapCsv, gapPeople, gapSummary } from './listHandlers';

// Program gaps (see services/programGaps.ts), admin side: every rule, plus
// creating and editing rules. The read endpoints are shared with offices
// (routes/listHandlers.ts, routes/officeLists.ts).
export const adminProgramGapsRouter = Router();
adminProgramGapsRouter.use(requireRole('admin'));

async function loadRule(id: string | undefined): Promise<GapRule | null> {
  if (!id || !z.string().uuid().safeParse(id).success) return null;
  const row = await getPrismaForRole('admin').programGapRule.findUnique({ where: { id } });
  return row ? toGapRule(row) : null;
}

adminProgramGapsRouter.get('/', gapSummary);
adminProgramGapsRouter.get('/:ruleId/people', gapPeople);
adminProgramGapsRouter.get('/:ruleId/people.csv', gapCsv);

const ruleSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    kind: z.enum(['missing', 'conflict']),
    targetModuleId: z.string().uuid(),
    sourceModuleIds: z.array(z.string().uuid()).max(10).default([]),
    minAge: z.number().int().min(0).max(130).nullable().optional(),
    maxAge: z.number().int().min(0).max(130).nullable().optional(),
    sex: z.enum(['M', 'F']).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((r) => r.minAge == null || r.maxAge == null || r.minAge <= r.maxAge, { message: 'Minimum age must not be above maximum age', path: ['maxAge'] })
  .refine((r) => !r.sourceModuleIds.includes(r.targetModuleId), { message: 'A program cannot be both the condition and the target', path: ['sourceModuleIds'] })
  // A 'missing' rule with no condition at all would list the whole registry.
  .refine((r) => r.kind === 'conflict' || r.minAge != null || r.maxAge != null || !!r.sex || r.sourceModuleIds.length > 0, {
    message: 'Add at least one condition (age, sex or a program)',
    path: ['sourceModuleIds'],
  });

async function programsExist(ids: string[]): Promise<boolean> {
  const unique = [...new Set(ids)];
  const n = await getPrismaForRole('admin').officeModule.count({ where: { id: { in: unique } } });
  return n === unique.length;
}

adminProgramGapsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, 400, 'VALIDATION_ERROR', 'Invalid rule', parsed.error.flatten()); return; }
    const d = parsed.data;
    if (!(await programsExist([d.targetModuleId, ...d.sourceModuleIds]))) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown program'); return; }
    const client = getPrismaForRole('admin');
    const created = await client.programGapRule.create({
      data: {
        name: d.name, description: d.description ?? null, kind: d.kind, targetModuleId: d.targetModuleId, sourceModuleIds: d.sourceModuleIds,
        minAge: d.minAge ?? null, maxAge: d.maxAge ?? null, sex: d.sex ?? null, isActive: d.isActive ?? true,
        createdBy: req.session.userId, updatedBy: req.session.userId,
      },
    });
    await insertAuditLog(client, { tableName: 'program_gap_rule', recordId: created.id, action: 'insert', actorUserId: req.session.userId, actorRole: req.session.role, changedFields: d });
    res.status(201).json(toGapRule(created));
  }),
);

adminProgramGapsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await loadRule(req.params.id);
    if (!existing) { sendError(res, 404, 'NOT_FOUND', 'No such program gap rule'); return; }
    const parsed = ruleSchema.safeParse({ ...existing, ...req.body });
    if (!parsed.success) { sendError(res, 400, 'VALIDATION_ERROR', 'Invalid rule', parsed.error.flatten()); return; }
    const d = parsed.data;
    if (!(await programsExist([d.targetModuleId, ...d.sourceModuleIds]))) { sendError(res, 400, 'VALIDATION_ERROR', 'Unknown program'); return; }
    const client = getPrismaForRole('admin');
    const updated = await client.programGapRule.update({
      where: { id: existing.id },
      data: {
        name: d.name, description: d.description ?? null, kind: d.kind, targetModuleId: d.targetModuleId, sourceModuleIds: d.sourceModuleIds,
        minAge: d.minAge ?? null, maxAge: d.maxAge ?? null, sex: d.sex ?? null, isActive: d.isActive ?? existing.isActive,
        updatedBy: req.session.userId,
      },
    });
    await insertAuditLog(client, {
      tableName: 'program_gap_rule', recordId: existing.id, action: 'update', actorUserId: req.session.userId, actorRole: req.session.role,
      changedFields: { before: existing, after: d },
    });
    res.json(toGapRule(updated));
  }),
);
