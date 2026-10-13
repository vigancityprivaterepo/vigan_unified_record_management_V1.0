import { Router } from 'express';
import { z } from 'zod';
import { insertAuditLog } from '../lib/auditLog';
import { asyncHandler } from '../lib/asyncHandler';
import { sendError } from '../lib/errors';
import { getPrismaForRole } from '../lib/prismaByRole';
import { slugify } from '../lib/slugify';
import { requireRole } from '../middleware/auth';

// Admin CRUD for offices, their modules, and each module's intake-form
// fields. Every office -- CSWD/Agriculture/Civil Registry included, as of
// the offices-as-modules unification -- shares this one management
// surface and the one office_staff Postgres role; see schema.prisma's
// comment above the Office model for why per-office DB roles don't scale
// (tried once for a single extra office, business_permits_staff, and
// reverted).
export const adminOfficesRouter = Router();
adminOfficesRouter.use(requireRole('admin'));

const OFFICE_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdAt: true,
  shortName: true,
  accentHue: true,
  icon: true,
} as const;

adminOfficesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const client = getPrismaForRole('admin');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [offices, modules, recordCounts, monthCounts, staffCounts] = await Promise.all([
      client.office.findMany({ select: OFFICE_SELECT, orderBy: { name: 'asc' } }),
      client.officeModule.findMany({ select: { id: true, officeId: true, name: true }, orderBy: { sortOrder: 'asc' } }),
      client.officeRecord.groupBy({ by: ['moduleId'], where: { isArchived: false }, _count: { _all: true } }),
      client.officeRecord.groupBy({ by: ['moduleId'], where: { isArchived: false, createdAt: { gte: monthStart } }, _count: { _all: true } }),
      client.staffAccount.groupBy({ by: ['officeId'], where: { isActive: true, officeId: { not: null } }, _count: { _all: true } }),
    ]);
    // Per-office totals for the sidebar's workspace list and the Offices cards.
    const officeByModule = new Map(modules.map((m) => [m.id, m.officeId]));
    const sumByOffice = (rows: Array<{ moduleId: string; _count: { _all: number } }>) => {
      const totals = new Map<string, number>();
      for (const row of rows) {
        const officeId = officeByModule.get(row.moduleId);
        if (officeId) totals.set(officeId, (totals.get(officeId) ?? 0) + row._count._all);
      }
      return totals;
    };
    const totals = sumByOffice(recordCounts);
    const monthTotals = sumByOffice(monthCounts);
    const staffByOffice = new Map(staffCounts.map((s) => [s.officeId, s._count._all]));
    res.json(
      offices.map((o) => ({
        ...o,
        recordCount: totals.get(o.id) ?? 0,
        recordsThisMonth: monthTotals.get(o.id) ?? 0,
        activeStaffCount: staffByOffice.get(o.id) ?? 0,
        modules: modules.filter((m) => m.officeId === o.id).map((m) => ({ id: m.id, name: m.name })),
      })),
    );
  }),
);

// slug doubles as this office's "module name" -- an admin-declared
// identifier (not silently auto-generated) used anywhere a stable
// machine-readable key for the office is needed. Same charset slugify()
// produces, enforced here so what admin types is what actually gets
// stored -- no silent reformatting between what's shown and what's saved.
const SLUG_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const createOfficeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers, and underscores only (e.g. business_permits)'),
  description: z.string().trim().max(500).optional(),
  accentHue: z.number().int().min(0).max(359).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  shortName: z.string().trim().max(20).nullable().optional(),
  // The office's first program: whether its records are about a person and
  // whether that person must be in the registry. Omitted = person, registry
  // required (the old fixed behaviour).
  collectPersonInfo: z.boolean().optional(),
  requiresCitizenLink: z.boolean().optional(),
});

// Every office gets one "default" module at creation -- most offices only
// ever need one form, so this keeps single-purpose office creation a
// single step; admin can rename it or add more modules afterward for an
// office that needs several (CSWD-style: Senior/PWD/Solo Parent under one
// login).
adminOfficesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createOfficeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid office payload', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole('admin');

    const existing = await client.office.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      sendError(res, 409, 'MODULE_NAME_TAKEN', `The identifier "${parsed.data.slug}" is already in use`);
      return;
    }

    const office = await client.office.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        slug: parsed.data.slug,
        accentHue: parsed.data.accentHue,
        icon: parsed.data.icon,
        shortName: parsed.data.shortName || null,
        createdBy: req.session.userId,
        modules: {
          create: {
            name: parsed.data.name,
            slug: 'default',
            sortOrder: 0,
            collectPersonInfo: parsed.data.collectPersonInfo ?? true,
            // Not about a person = nothing to link.
            requiresCitizenLink: (parsed.data.collectPersonInfo ?? true) ? (parsed.data.requiresCitizenLink ?? true) : false,
          },
        },
      },
      select: OFFICE_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'office',
      recordId: office.id,
      action: 'insert',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { name: office.name, slug: office.slug },
    });

    res.status(201).json(office);
  }),
);

const updateOfficeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  accentHue: z.number().int().min(0).max(359).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  shortName: z.string().trim().max(20).nullable().optional(),
});

adminOfficesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateOfficeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid office payload', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole('admin');
    const existing = await client.office.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such office');
      return;
    }

    const office = await client.office.update({
      where: { id: req.params.id },
      data: { ...parsed.data, ...(parsed.data.shortName !== undefined ? { shortName: parsed.data.shortName || null } : {}) },
      select: OFFICE_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'office',
      recordId: office.id,
      action: 'update',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      // Keep the old name/description so a rename (e.g. fixing a typo) is traceable.
      changedFields: {
        ...parsed.data,
        ...(parsed.data.name !== undefined || parsed.data.description !== undefined || parsed.data.shortName !== undefined
          ? { previous: { name: existing.name, shortName: existing.shortName, description: existing.description } }
          : {}),
      },
    });

    res.json(office);
  }),
);

// Both office_module and staff_account FK to office with no cascade (see
// \d office in the live DB), so a plain DELETE would fail with a raw
// Postgres FK error the moment either exists -- checked here first for a
// clear message instead. Reassign or remove every staff account before an
// office can go -- that's always an explicit admin decision, never
// automatic. Modules are different: every office starts with one empty
// "default" module the moment it's created, so blocking deletion on that
// alone would mean a brand-new, never-used office could never be removed
// without a separate trip to delete its module first. `?force=true`
// auto-removes any module that's genuinely empty (no records, not used as
// a dashboard widget source) -- a module with either of those still blocks
// deletion even with force, same as it does standalone.
adminOfficesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const existing = await client.office.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such office');
      return;
    }

    const [modules, staffCount] = await Promise.all([
      client.officeModule.findMany({ where: { officeId: req.params.id }, select: { id: true, name: true } }),
      client.staffAccount.count({ where: { officeId: req.params.id } }),
    ]);
    if (staffCount > 0) {
      sendError(res, 409, 'OFFICE_HAS_STAFF', "Reassign or delete this office's staff accounts first");
      return;
    }

    if (modules.length > 0) {
      if (req.query.force !== 'true') {
        sendError(res, 409, 'OFFICE_HAS_MODULES', 'Remove every program from this office first', {
          moduleCount: modules.length,
        });
        return;
      }

      const nonEmpty: string[] = [];
      for (const m of modules) {
        // eslint-disable-next-line no-await-in-loop -- a handful of modules per office at most, sequential is fine.
        const [recordCount, widgetSourceCount] = await Promise.all([
          client.officeRecord.count({ where: { moduleId: m.id } }),
          client.dashboardWidgetSource.count({ where: { moduleId: m.id } }),
        ]);
        if (recordCount > 0 || widgetSourceCount > 0) nonEmpty.push(m.name);
      }
      if (nonEmpty.length > 0) {
        sendError(
          res,
          409,
          'OFFICE_HAS_MODULES',
          `These programs have saved records or are used by a chart, so they weren't removed automatically: ${nonEmpty.join(', ')}`,
        );
        return;
      }

      const moduleIds = modules.map((m) => m.id);
      await client.officeFormField.deleteMany({ where: { moduleId: { in: moduleIds } } });
      await client.officeModule.deleteMany({ where: { id: { in: moduleIds } } });
    }

    await client.office.delete({ where: { id: req.params.id } });

    await insertAuditLog(client, {
      tableName: 'office',
      recordId: existing.id,
      action: 'delete',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { name: existing.name, slug: existing.slug },
    });

    res.status(204).send();
  }),
);

// --- Modules -----------------------------------------------------------------
// A module is one form/record-type within an office. Most offices have
// exactly one; some need more under a single login (CSWD: Senior/PWD/Solo
// Parent, Civil Registry: Birth/Death).

const MODULE_SELECT = {
  id: true,
  officeId: true,
  name: true,
  slug: true,
  requiresCitizenLink: true,
  sortOrder: true,
  collectSex: true,
  collectCivilStatus: true,
  collectStreet: true,
  collectBarangay: true,
  collectPersonInfo: true,
  givesAssistance: true,
  assistanceAmountKey: true,
} as const;

adminOfficesRouter.get(
  '/:id/modules',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const modules = await client.officeModule.findMany({
      where: { officeId: req.params.id },
      select: MODULE_SELECT,
      orderBy: { sortOrder: 'asc' },
    });
    res.json(modules);
  }),
);

const createModuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers, and underscores only (e.g. solo_parent)'),
  // Off only for a module like Civil Registry's Birth, where a submission
  // may stand alone with no Citizen to link (a family passing through
  // Vigan without residing here still gets the birth recorded).
  requiresCitizenLink: z.boolean().optional(),
  // Last/first/middle name + birthdate are always collected when
  // collectPersonInfo is true -- these four gate only the rest of the core
  // block. Undeclared = on, same as every module before this existed.
  collectSex: z.boolean().optional(),
  collectCivilStatus: z.boolean().optional(),
  collectStreet: z.boolean().optional(),
  collectBarangay: z.boolean().optional(),
  // Off for a module that isn't about a person at all (Assessor's "Lots").
  // Forces requiresCitizenLink off too -- see schema.prisma's comment.
  collectPersonInfo: z.boolean().optional(),
});

adminOfficesRouter.post(
  '/:id/modules',
  asyncHandler(async (req, res) => {
    const parsed = createModuleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Check the program details', parsed.error.flatten());
      return;
    }
    const collectPersonInfo = parsed.data.collectPersonInfo ?? true;
    const officeId = req.params.id!;
    const client = getPrismaForRole('admin');
    const office = await client.office.findUnique({ where: { id: officeId } });
    if (!office) {
      sendError(res, 404, 'NOT_FOUND', 'No such office');
      return;
    }

    const existing = await client.officeModule.findUnique({
      where: { officeId_slug: { officeId, slug: parsed.data.slug } },
    });
    if (existing) {
      sendError(res, 409, 'MODULE_SLUG_TAKEN', `A program with the identifier "${parsed.data.slug}" already exists in this office`);
      return;
    }

    const maxSort = await client.officeModule.aggregate({
      where: { officeId },
      _max: { sortOrder: true },
    });

    const officeModule = await client.officeModule.create({
      data: {
        officeId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        // No person info collected means resolvePerson() has nothing to
        // match on, so a citizen link can never be required in that case --
        // collectPersonInfo wins over whatever requiresCitizenLink was sent.
        requiresCitizenLink: collectPersonInfo ? (parsed.data.requiresCitizenLink ?? true) : false,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        collectSex: parsed.data.collectSex ?? true,
        collectCivilStatus: parsed.data.collectCivilStatus ?? true,
        collectStreet: parsed.data.collectStreet ?? true,
        collectBarangay: parsed.data.collectBarangay ?? true,
        collectPersonInfo,
      },
      select: MODULE_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'office_module',
      recordId: officeModule.id,
      action: 'insert',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { officeId: req.params.id, name: officeModule.name, slug: officeModule.slug },
    });

    res.status(201).json(officeModule);
  }),
);

const updateModuleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  requiresCitizenLink: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  collectSex: z.boolean().optional(),
  collectCivilStatus: z.boolean().optional(),
  collectStreet: z.boolean().optional(),
  collectBarangay: z.boolean().optional(),
  collectPersonInfo: z.boolean().optional(),
  // See schema.prisma: counts this program's records on the Assistance page.
  givesAssistance: z.boolean().optional(),
  assistanceAmountKey: z.string().trim().min(1).max(120).nullable().optional(),
});

adminOfficesRouter.patch(
  '/:id/modules/:moduleId',
  asyncHandler(async (req, res) => {
    const parsed = updateModuleSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Check the program details', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole('admin');
    const existing = await client.officeModule.findFirst({ where: { id: req.params.moduleId, officeId: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such program');
      return;
    }

    // Same rule as create: collectPersonInfo false always forces
    // requiresCitizenLink false too, whether that's this request turning
    // person info off, or a still-off module from before this request.
    const collectPersonInfo = parsed.data.collectPersonInfo ?? existing.collectPersonInfo;
    // The amount field must be one of this program's NUMBER fields, and is
    // dropped when the program stops counting as assistance.
    const givesAssistance = parsed.data.givesAssistance ?? existing.givesAssistance;
    const assistanceAmountKey = !givesAssistance ? null : parsed.data.assistanceAmountKey === undefined ? existing.assistanceAmountKey : parsed.data.assistanceAmountKey;
    if (assistanceAmountKey && !(await client.officeFormField.count({ where: { moduleId: existing.id, key: assistanceAmountKey, fieldType: 'NUMBER' } }))) {
      sendError(res, 400, 'VALIDATION_ERROR', "The amount field must be one of this program's number fields");
      return;
    }
    const data = {
      ...parsed.data,
      requiresCitizenLink: collectPersonInfo ? (parsed.data.requiresCitizenLink ?? existing.requiresCitizenLink) : false,
      assistanceAmountKey,
    };

    const officeModule = await client.officeModule.update({
      where: { id: req.params.moduleId },
      data,
      select: MODULE_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'office_module',
      recordId: officeModule.id,
      action: 'update',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: data,
    });

    res.json(officeModule);
  }),
);

// A module is only removable while it has no saved records -- otherwise
// those records would be orphaned with no form left to render/list them.
// Admin can deactivate the whole office instead if a module's no longer
// wanted but its history must be kept. Its own fields don't block deletion
// the same way -- with zero records under the module, no OfficeRecord.data
// blob anywhere actually references those field keys, so removing them
// alongside the module loses nothing (unlike deleting a single field via
// the route below, which can leave old records' data behind on purpose).
// A widget using this module as a data source does still block it, same
// as a record would -- silently dropping a source out from under a saved
// chart isn't a "nothing to lose" cleanup the way empty fields are.
adminOfficesRouter.delete(
  '/:id/modules/:moduleId',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const existing = await client.officeModule.findFirst({ where: { id: req.params.moduleId, officeId: req.params.id } });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such program');
      return;
    }
    const [recordCount, widgetSourceCount] = await Promise.all([
      client.officeRecord.count({ where: { moduleId: req.params.moduleId } }),
      client.dashboardWidgetSource.count({ where: { moduleId: req.params.moduleId } }),
    ]);
    if (recordCount > 0) {
      sendError(res, 409, 'MODULE_HAS_RECORDS', 'This program has saved records and cannot be removed');
      return;
    }
    if (widgetSourceCount > 0) {
      sendError(res, 409, 'MODULE_USED_BY_WIDGET', 'This program is used by a chart. Remove the chart first.');
      return;
    }

    await client.officeFormField.deleteMany({ where: { moduleId: req.params.moduleId } });
    await client.officeModule.delete({ where: { id: req.params.moduleId } });

    await insertAuditLog(client, {
      tableName: 'office_module',
      recordId: existing.id,
      action: 'delete',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { name: existing.name },
    });

    res.status(204).send();
  }),
);

// --- Form fields (fixed type palette: TEXT/NUMBER/DATE/BOOLEAN/SELECT/FILE) -

const FIELD_SELECT = {
  id: true,
  moduleId: true,
  key: true,
  label: true,
  fieldType: true,
  options: true,
  isRequired: true,
  sortOrder: true,
} as const;

adminOfficesRouter.get(
  '/:id/modules/:moduleId/fields',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const fields = await client.officeFormField.findMany({
      where: { moduleId: req.params.moduleId },
      select: FIELD_SELECT,
      orderBy: { sortOrder: 'asc' },
    });
    res.json(fields);
  }),
);

const createFieldSchema = z.object({
  label: z.string().trim().min(1).max(120),
  fieldType: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'FILE', 'MULTISELECT', 'TEXTAREA', 'EMAIL', 'PHONE', 'TIME']),
  options: z.array(z.string().trim().min(1)).optional(),
  isRequired: z.boolean().optional(),
});

// Every module's intake form already collects these -- see
// PersonCoreFields.tsx / coreSchema in office.ts -- so a custom field
// reusing one of them (e.g. an admin adding their own "First Name" field,
// not realizing the form already has one) would just show up twice on the
// form, once wired to the real core value and once as a dead, always-empty
// duplicate. Compared as slugs, the same normalization a label's JSON key
// already goes through, so "First Name" and "first-name" both match.
const CORE_FIELD_SLUGS = new Set([
  'first_name',
  'last_name',
  'middle_name',
  'birthdate',
  'birth_date',
  'sex',
  'gender',
  'civil_status',
  'street',
  'barangay',
]);

async function uniqueFieldKey(
  client: ReturnType<typeof getPrismaForRole>,
  moduleId: string,
  base: string,
): Promise<string> {
  let key = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop -- sequential by design: each check depends on the last collision.
  while (await client.officeFormField.findUnique({ where: { moduleId_key: { moduleId, key } } })) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

adminOfficesRouter.post(
  '/:id/modules/:moduleId/fields',
  asyncHandler(async (req, res) => {
    const parsed = createFieldSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid field payload', parsed.error.flatten());
      return;
    }
    if (
      (parsed.data.fieldType === 'SELECT' || parsed.data.fieldType === 'MULTISELECT') &&
      (!parsed.data.options || parsed.data.options.length === 0)
    ) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Dropdown/Multi-select fields need at least one option');
      return;
    }
    const labelSlug = slugify(parsed.data.label);
    if (CORE_FIELD_SLUGS.has(labelSlug)) {
      sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `"${parsed.data.label}" is already on every program's form, so there is no need to add it`,
        { label: ["Already on every program's form"] },
      );
      return;
    }
    const client = getPrismaForRole('admin');
    const officeModule = await client.officeModule.findFirst({ where: { id: req.params.moduleId, officeId: req.params.id } });
    if (!officeModule) {
      sendError(res, 404, 'NOT_FOUND', 'No such program');
      return;
    }

    const key = await uniqueFieldKey(client, officeModule.id, labelSlug);
    const maxSort = await client.officeFormField.aggregate({
      where: { moduleId: officeModule.id },
      _max: { sortOrder: true },
    });

    const field = await client.officeFormField.create({
      data: {
        moduleId: officeModule.id,
        key,
        label: parsed.data.label,
        fieldType: parsed.data.fieldType,
        options: parsed.data.options ?? [],
        isRequired: parsed.data.isRequired ?? false,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
      select: FIELD_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'office_form_field',
      recordId: field.id,
      action: 'insert',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { moduleId: officeModule.id, key: field.key, label: field.label, fieldType: field.fieldType },
    });

    res.status(201).json(field);
  }),
);

const updateFieldSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  options: z.array(z.string().trim().min(1)).optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminOfficesRouter.patch(
  '/:id/modules/:moduleId/fields/:fieldId',
  asyncHandler(async (req, res) => {
    const parsed = updateFieldSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid field payload', parsed.error.flatten());
      return;
    }
    if (parsed.data.label && CORE_FIELD_SLUGS.has(slugify(parsed.data.label))) {
      sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `"${parsed.data.label}" is already on every program's form, so there is no need for it`,
        { label: ["Already on every program's form"] },
      );
      return;
    }
    const client = getPrismaForRole('admin');
    const existing = await client.officeFormField.findFirst({
      where: { id: req.params.fieldId, moduleId: req.params.moduleId },
    });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such field');
      return;
    }

    const field = await client.officeFormField.update({
      where: { id: req.params.fieldId },
      data: parsed.data,
      select: FIELD_SELECT,
    });

    await insertAuditLog(client, {
      tableName: 'office_form_field',
      recordId: field.id,
      action: 'update',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: parsed.data,
    });

    res.json(field);
  }),
);

// Deleting a field only stops it from being collected/shown going forward --
// past OfficeRecord.data blobs keep whatever value was captured under that
// key at the time (JSONB has no FK to office_form_field to cascade).
adminOfficesRouter.delete(
  '/:id/modules/:moduleId/fields/:fieldId',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const existing = await client.officeFormField.findFirst({
      where: { id: req.params.fieldId, moduleId: req.params.moduleId },
    });
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'No such field');
      return;
    }

    await client.officeFormField.delete({ where: { id: req.params.fieldId } });

    await insertAuditLog(client, {
      tableName: 'office_form_field',
      recordId: existing.id,
      action: 'delete',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { key: existing.key },
    });

    res.status(204).send();
  }),
);
