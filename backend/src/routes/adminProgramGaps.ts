import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendCsv } from '../lib/csv';
import { sendError } from '../lib/errors';
import { parsePage, type Paginated } from '../lib/pagination';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { countGap, listGapPeople, toGapRule, usesSampleData, type GapPerson, type GapRule } from '../services/programGaps';

// Program gaps (see services/programGaps.ts). Admin only: the rules read
// across every office's records. Viewing or exporting a people list is
// audit-logged, since it shows who is (or isn't) in which program.
export const adminProgramGapsRouter = Router();
adminProgramGapsRouter.use(requireRole('admin'));

const PAGE_SIZE = 25;

function filtersOf(req: Request) {
  const code = typeof req.query.barangayCode === 'string' && req.query.barangayCode ? req.query.barangayCode : undefined;
  return { barangayCode: code };
}

async function loadRule(id: string | undefined): Promise<GapRule | null> {
  if (!id || !z.string().uuid().safeParse(id).success) return null;
  const row = await getPrismaForRole('admin').programGapRule.findUnique({ where: { id } });
  return row ? toGapRule(row) : null;
}

adminProgramGapsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const filters = filtersOf(req);
    const [rows, modules] = await Promise.all([
      client.programGapRule.findMany({ orderBy: [{ kind: 'desc' }, { createdAt: 'asc' }] }),
      client.officeModule.findMany({
        select: { id: true, name: true, office: { select: { id: true, name: true, shortName: true, accentHue: true, icon: true, isActive: true } } },
        orderBy: [{ office: { name: 'asc' } }, { sortOrder: 'asc' }],
      }),
    ]);
    const moduleById = new Map(modules.map((m) => [m.id, m]));
    const rules = await Promise.all(
      rows.map(async (row) => {
        const rule = toGapRule(row);
        const [count, sample] = rule.isActive
          ? await Promise.all([countGap(client, rule, filters), usesSampleData(client, rule)])
          : [null, false];
        const target = moduleById.get(rule.targetModuleId);
        return {
          ...rule,
          targetProgram: target ? { id: target.id, name: target.name, office: target.office } : null,
          sourcePrograms: rule.sourceModuleIds.map((id) => moduleById.get(id)?.name ?? 'Removed program'),
          total: count?.total ?? null,
          byBarangay: count?.byBarangay.slice(0, 5) ?? [],
          usesSampleData: sample,
        };
      }),
    );
    res.json({
      rules,
      programs: modules.filter((m) => m.office.isActive).map((m) => ({ id: m.id, name: m.name, officeName: m.office.shortName || m.office.name })),
    });
  }),
);

adminProgramGapsRouter.get(
  '/:id/people',
  asyncHandler(async (req, res) => {
    const rule = await loadRule(req.params.id);
    if (!rule) { sendError(res, 404, 'NOT_FOUND', 'No such program gap rule'); return; }
    const client = getPrismaForRole('admin');
    const filters = filtersOf(req);
    const page = parsePage(req.query.page);
    const [{ total }, items] = await Promise.all([
      countGap(client, rule, filters),
      listGapPeople(client, rule, filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    ]);
    await insertAuditLog(client, {
      tableName: 'program_gap_rule',
      recordId: rule.id,
      action: 'read',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { view: 'people', page, barangayCode: filters.barangayCode ?? null, rows: items.length },
    });
    const body: Paginated<GapPerson> = { items, total, page, pageSize: PAGE_SIZE };
    res.json(body);
  }),
);

adminProgramGapsRouter.get(
  '/:id/people.csv',
  asyncHandler(async (req, res) => {
    const rule = await loadRule(req.params.id);
    if (!rule) { sendError(res, 404, 'NOT_FOUND', 'No such program gap rule'); return; }
    const client = getPrismaForRole('admin');
    const filters = filtersOf(req);
    const people = await listGapPeople(client, rule, filters, null);
    await insertAuditLog(client, {
      tableName: 'program_gap_rule',
      recordId: rule.id,
      action: 'read',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { view: 'export', barangayCode: filters.barangayCode ?? null, rows: people.length },
    });
    const date = new Date().toISOString().slice(0, 10);
    sendCsv(
      res,
      `program-gap-${rule.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}.csv`,
      ['Name', 'Age', 'Sex', 'Barangay', 'In program(s)', 'Rule'],
      people.map((p) => [p.name, p.age, p.sex, p.barangay, p.sourcePrograms.join('; '), rule.name]),
    );
  }),
);

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
