import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { buildDynamicFieldsSchema, type DynamicFieldDef } from '../lib/dynamicFieldSchema';
import { documentUpload } from '../lib/documentUpload';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendCsv } from '../lib/csv';
import { sendError } from '../lib/errors';
import { readDocument, uploadDocument } from '../lib/documentStorage';
import { getPrismaForRole } from '../lib/prismaByRole';
import { parsePage } from '../lib/pagination';
import { makeDocumentObjectKey } from '../lib/sanitizeFilename';
import { uppercaseFreeText, uppercaseStrings } from '../lib/textNormalize';
import { requireOfficeAccess } from '../middleware/auth';
import { addHouseholdMember, designateHouseholdHead } from '../services/households';
import { allModuleRecords, listModuleRecords, parseStatus, type RecordStatus } from '../services/officeRecordList';
import { createOfficeRecord } from '../services/officeSatelliteWriters';
import { resolvePerson } from '../services/resolvePerson';

// The staff-facing side of every office -- CSWD/Agriculture/Civil Registry
// included as of the offices-as-modules unification, not just
// admin-created ones. requireOfficeAccess (not requireRole) is what
// actually enforces that an office_staff session can only reach its own
// :officeId -- see that middleware's comment in middleware/auth.ts.
export const officeRouter = Router();

const OFFICE_SELECT = { id: true, name: true, shortName: true, slug: true, description: true, isActive: true, accentHue: true, icon: true } as const;
const MODULE_SELECT = {
  id: true,
  name: true,
  slug: true,
  requiresCitizenLink: true,
  sortOrder: true,
  collectSex: true,
  collectCivilStatus: true,
  collectStreet: true,
  collectBarangay: true,
  collectPersonInfo: true,
} as const;
const FIELD_SELECT = {
  id: true,
  key: true,
  label: true,
  fieldType: true,
  options: true,
  isRequired: true,
  sortOrder: true,
} as const;

const CITIZEN_SEARCH_SELECT = {
  personKey: true,
  personLname: true,
  personFname: true,
  personMname: true,
  personBdate: true,
  personIsHead: true,
  isArchived: true,
  barangay: { select: { name: true } },
} as const;

// Search-only, top 20 matches -- no pagination, this backs the household
// link picker on an office's own intake form (e.g. Civil Registry's Birth
// module linking a newborn to a parent's household), not a full roster
// browse like admin's Citizens page. office_staff already has SELECT on
// every Citizen column this needs (see the office_staff grant migration's
// comment on why -- resolvePerson()'s own duplicate detection needs the
// same columns), so no new grant is required.
officeRouter.get('/:officeId/citizen-search', requireOfficeAccess, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const client = getPrismaForRole(req.session.role!);
  const citizens = await client.citizen.findMany({
    where: q
      ? {
          OR: [
            { personLname: { contains: q, mode: 'insensitive' as const } },
            { personFname: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined,
    select: CITIZEN_SEARCH_SELECT,
    orderBy: [{ personLname: 'asc' }, { personFname: 'asc' }],
    take: 20,
  });
  res.json(citizens);
});

officeRouter.get('/:officeId', requireOfficeAccess, async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const office = await client.office.findUnique({ where: { id: req.params.officeId }, select: OFFICE_SELECT });
  if (!office) {
    sendError(res, 404, 'NOT_FOUND', 'No such office');
    return;
  }
  res.json(office);
});

officeRouter.get('/:officeId/modules', requireOfficeAccess, async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const modules = await client.officeModule.findMany({
    where: { officeId: req.params.officeId },
    select: MODULE_SELECT,
    orderBy: { sortOrder: 'asc' },
  });
  res.json(modules);
});

// Every route below also takes :moduleId -- this confirms it actually
// belongs to :officeId (requireOfficeAccess only checks the office) so an
// office_staff session for office A can never reach office B's module data
// by guessing/reusing a moduleId, even though both pass the office check.
async function requireModuleInOffice(
  client: ReturnType<typeof getPrismaForRole>,
  officeId: string | undefined,
  moduleId: string | undefined,
) {
  if (!officeId || !moduleId) return null;
  const officeModule = await client.officeModule.findUnique({ where: { id: moduleId } });
  if (!officeModule || officeModule.officeId !== officeId) return null;
  return officeModule;
}

officeRouter.get('/:officeId/modules/:moduleId/fields', requireOfficeAccess, async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
  if (!officeModule) {
    sendError(res, 404, 'NOT_FOUND', 'No such module');
    return;
  }
  const fields = await client.officeFormField.findMany({
    where: { moduleId: officeModule.id },
    select: FIELD_SELECT,
    orderBy: { sortOrder: 'asc' },
  });
  res.json(fields);
});

const addressFields = {
  sex: z.string().trim().optional(),
  gender: z.string().trim().optional(),
  civilStatus: z.string().trim().optional(),
  street: z.string().trim().optional(),
  brgyCode: z.string().trim().optional(),
};

// multipart/form-data text fields are always strings -- z.coerce.boolean()
// would treat the string "false" as truthy (Boolean("false") === true).
const formBoolean = z.preprocess((val) => (typeof val === 'string' ? val === 'true' : val), z.boolean());

const coreSchema = z.object({
  lname: z.string().trim().min(1),
  fname: z.string().trim().min(1),
  mname: z.string().trim().optional(),
  bdate: z.coerce.date(),
  ...addressFields,
  // Only consulted when the module's own requiresCitizenLink is false --
  // whether this particular submission should still attempt to link a
  // Citizen (mirrors what was birthIsFromVigan when Birth was its own
  // hand-built form). Ignored (always true) for every other module.
  linkToCitizen: formBoolean.default(false),
  // Optional household link -- e.g. Civil Registry's Birth module linking a
  // newborn to a parent's household at the moment of registration, instead
  // of admin having to do it separately afterward on the Households page.
  // Available to every collectPersonInfo module, not just Birth (see
  // households.ts's own comment on why this is shared, not duplicated).
  householdParentKey: z.string().uuid().optional(),
  householdRelation: z.string().trim().min(1).max(60).optional(),
});

// Every submission is multipart/form-data, even for modules with no FILE
// fields -- one request shape for every module instead of a JSON path and a
// separate form-data-only path for whichever modules happen to need a file
// upload. Core fields arrive as individual text parts, admin-defined
// non-file fields as one JSON-encoded `fields` text part (nested objects
// can't be normal multipart fields), and FILE fields as actual file parts
// named by their field key.
officeRouter.post(
  '/:officeId/modules/:moduleId/records',
  requireOfficeAccess,
  documentUpload.any(),
  async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const office = await client.office.findUnique({ where: { id: req.params.officeId } });
    if (!office || !office.isActive) {
      sendError(res, 404, 'NOT_FOUND', 'No such office');
      return;
    }
    const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
    if (!officeModule) {
      sendError(res, 404, 'NOT_FOUND', 'No such module');
      return;
    }

    // A module with collectPersonInfo=false isn't about a person at all
    // (e.g. an Assessor's Office "Lots" module) -- core.coreSchema (name,
    // birthdate, ...) is never parsed for it, so it can't fail on those
    // fields, and its records carry neither a person_key nor an
    // unresolved_person, just whatever this module's own fields are.
    let core: Record<string, unknown> = {};
    if (officeModule.collectPersonInfo) {
      const parsedCore = coreSchema.safeParse(req.body);
      if (!parsedCore.success) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid intake payload', parsedCore.error.flatten());
        return;
      }
      core = uppercaseStrings(parsedCore.data as unknown as Record<string, unknown>);
    }

    const fieldDefs = await client.officeFormField.findMany({ where: { moduleId: officeModule.id } });
    const fileFieldDefs = fieldDefs.filter((f) => f.fieldType === 'FILE');
    const jsonFieldDefs: DynamicFieldDef[] = fieldDefs.filter((f) => f.fieldType !== 'FILE');

    let rawFields: unknown = {};
    if (typeof req.body.fields === 'string' && req.body.fields.length > 0) {
      try {
        rawFields = JSON.parse(req.body.fields);
      } catch {
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid fields payload');
        return;
      }
    }
    const fieldsParsed = buildDynamicFieldsSchema(jsonFieldDefs).safeParse(rawFields);
    if (!fieldsParsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid intake fields', fieldsParsed.error.flatten());
      return;
    }

    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    const fileValues: Record<string, string> = {};
    for (const field of fileFieldDefs) {
      const file = uploadedFiles.find((f) => f.fieldname === field.key);
      if (!file) {
        if (field.isRequired) {
          sendError(res, 400, 'VALIDATION_ERROR', `${field.label} is required`);
          return;
        }
        continue;
      }
      const objectKey = makeDocumentObjectKey(file.originalname);
      await uploadDocument(objectKey, file.buffer, file.mimetype);
      // Never uppercased below -- a MinIO object key must round-trip
      // exactly as generated, unlike every other submitted value.
      fileValues[field.key] = objectKey;
    }

    const data = { ...uppercaseFreeText(fieldsParsed.data, jsonFieldDefs), ...fileValues };
    const role = req.session.role!;
    const actorUserId = req.session.userId!;

    if (!officeModule.collectPersonInfo) {
      try {
        const record = await createOfficeRecord(client, officeModule.id, null, null, data, actorUserId);
        await insertAuditLog(client, {
          tableName: record.table,
          recordId: record.recordId,
          action: 'insert',
          actorUserId,
          actorRole: role,
        });
        res.status(201).json({ status: 'recorded', recordId: record.recordId });
      } catch (err) {
        console.error(err);
        sendError(res, 500, 'INTERNAL_ERROR', 'Failed to register record');
      }
      return;
    }

    try {
      const shouldLink = officeModule.requiresCitizenLink || Boolean(core.linkToCitizen);

      if (!shouldLink) {
        const record = await createOfficeRecord(
          client,
          officeModule.id,
          null,
          { lname: core.lname, fname: core.fname, mname: core.mname, bdate: core.bdate },
          data,
          actorUserId,
        );
        await insertAuditLog(client, {
          tableName: record.table,
          recordId: record.recordId,
          action: 'insert',
          actorUserId,
          actorRole: role,
        });
        res.status(201).json({ status: 'recorded_no_citizen_link', recordId: record.recordId });
        return;
      }

      const resolveResult = await resolvePerson(
        {
          lname: core.lname as string,
          fname: core.fname as string,
          mname: core.mname as string | undefined,
          bdate: core.bdate as Date,
          sex: core.sex as string | undefined,
          civilStatus: core.civilStatus as string | undefined,
          street: core.street as string | undefined,
          brgyCode: core.brgyCode as string | undefined,
        },
        { actorUserId, client },
      );

      if (resolveResult.status === 'needs_review') {
        await client.$executeRaw`
          INSERT INTO duplicate_review_queue_item (module_id, candidate_data, fuzzy_matches, created_by)
          VALUES (
            ${officeModule.id}::uuid,
            ${JSON.stringify({ lname: core.lname, fname: core.fname, mname: core.mname, bdate: core.bdate, fields: data })}::jsonb,
            ${JSON.stringify(resolveResult.candidates)}::jsonb,
            ${actorUserId}::uuid
          )
        `;
        await insertAuditLog(client, {
          tableName: 'duplicate_review_queue_item',
          action: 'insert',
          actorUserId,
          actorRole: role,
          changedFields: { moduleId: officeModule.id, lname: core.lname as string, fname: core.fname as string },
        });
        res.status(202).json({ status: 'needs_review', candidates: resolveResult.candidates });
        return;
      }

      if (resolveResult.status === 'created') {
        await insertAuditLog(client, {
          tableName: 'Citizen',
          recordId: resolveResult.personKey,
          action: 'insert',
          actorUserId,
          actorRole: role,
        });
      }

      const record = await createOfficeRecord(client, officeModule.id, resolveResult.personKey, null, data, actorUserId);
      await insertAuditLog(client, {
        tableName: record.table,
        recordId: record.recordId,
        action: 'insert',
        actorUserId,
        actorRole: role,
      });

      // Best-effort: the intake itself is already saved above, so a problem
      // linking the household (parent not found, this person already heads
      // their own household, ...) is surfaced as a warning, not a failure --
      // losing an otherwise-valid Birth record over a secondary link would
      // be worse than just telling staff to fix the household link
      // separately on the Households page.
      let householdLinkWarning: string | undefined;
      const householdParentKey = core.householdParentKey as string | undefined;
      if (householdParentKey) {
        const relation = (core.householdRelation as string | undefined)?.trim() || 'CHILD';
        const headResult = await designateHouseholdHead(client, householdParentKey, actorUserId, role);
        if (!headResult.ok) {
          householdLinkWarning = headResult.message;
        } else {
          const memberResult = await addHouseholdMember(
            client,
            householdParentKey,
            resolveResult.personKey,
            relation,
            actorUserId,
            role,
          );
          if (!memberResult.ok) householdLinkWarning = memberResult.message;
        }
      }

      res.status(201).json({
        status: resolveResult.status,
        personKey: resolveResult.personKey,
        recordId: record.recordId,
        householdLinkWarning,
      });
    } catch (err) {
      console.error(err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to register record');
    }
  },
);

// Records page list: office_record rows plus this module's pending duplicate
// review items, each tagged with a registry status (see officeRecordList.ts),
// filterable by ?status= and searchable by ?q= (last/first name).
officeRouter.get('/:officeId/modules/:moduleId/records', requireOfficeAccess, asyncHandler(async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
  if (!officeModule) {
    sendError(res, 404, 'NOT_FOUND', 'No such module');
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const result = await listModuleRecords(client, officeModule.id, {
    q: q || undefined,
    status: parseStatus(req.query.status),
    page: parsePage(req.query.page),
    archived: req.query.archived === 'true',
  });
  res.json(result);
}));

const STATUS_LABEL: Record<RecordStatus, string> = {
  linked: 'Linked to registry',
  new: 'New citizen added',
  unlinked: 'Not linked',
  review: 'Awaiting admin review',
};

// CSV of every active record in one module, with the module's own form
// fields as columns (FILE fields left out -- they're object-store keys, not
// data). Exports carry personal data (RA 10173), so each one is audit-logged
// with who exported what and how many rows.
officeRouter.get('/:officeId/modules/:moduleId/records/export.csv', requireOfficeAccess, asyncHandler(async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
  if (!officeModule) {
    sendError(res, 404, 'NOT_FOUND', 'No such module');
    return;
  }
  const [fields, records] = await Promise.all([
    client.officeFormField.findMany({
      where: { moduleId: officeModule.id, fieldType: { not: 'FILE' } },
      select: { key: true, label: true },
      orderBy: { sortOrder: 'asc' },
    }),
    allModuleRecords(client, officeModule.id),
  ]);

  const header = ['Last name', 'First name', 'Middle name', 'Birthdate', 'Barangay', 'Registry status', 'Added', ...fields.map((f) => f.label)];
  const rows = records.map((r) => {
    const u = (r.unresolvedPerson ?? {}) as { lname?: string; fname?: string; mname?: string; bdate?: string };
    const data = (r.data ?? {}) as Record<string, unknown>;
    return [
      r.citizen?.personLname ?? u.lname,
      r.citizen?.personFname ?? u.fname,
      r.citizen?.personMname ?? u.mname,
      r.citizen?.personBdate ?? u.bdate?.slice(0, 10),
      r.citizen?.barangay?.name,
      STATUS_LABEL[r.status],
      r.createdAt,
      ...fields.map((f) => {
        const v = data[f.key];
        return Array.isArray(v) ? v.join('; ') : (v as string | number | boolean | null | undefined);
      }),
    ];
  });

  await insertAuditLog(client, {
    tableName: 'office_record',
    action: 'read',
    actorUserId: req.session.userId,
    actorRole: req.session.role,
    changedFields: { event: 'export_csv', moduleId: officeModule.id, rowCount: rows.length },
  });

  sendCsv(res, `${officeModule.slug}-records-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
}));

// --- Corrections -------------------------------------------------------------
// Staff fix input mistakes by editing a record (never by deleting and
// re-entering). Only the program's own form fields can change, plus the
// name/birthdate of a record NOT linked to a citizen. A linked citizen's
// identity is shared registry data, so admin corrects it from Citizens. A
// reason is required and the audit entry keeps each changed value's
// before/after, so any correction can be traced and undone.
const editRecordSchema = z.object({
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required'),
  fields: z.record(z.unknown()).default({}),
  person: z
    .object({
      lname: z.string().trim().min(1).optional(),
      fname: z.string().trim().min(1).optional(),
      mname: z.string().trim().optional(),
      bdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
    })
    .optional(),
});

officeRouter.patch(
  '/:officeId/modules/:moduleId/records/:recordId',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const parsed = editRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid correction', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole(req.session.role!);
    const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
    if (!officeModule) {
      sendError(res, 404, 'NOT_FOUND', 'No such module');
      return;
    }
    const record = await client.officeRecord.findUnique({ where: { id: req.params.recordId } });
    if (!record || record.moduleId !== officeModule.id || record.isArchived) {
      sendError(res, 404, 'NOT_FOUND', 'No such record');
      return;
    }

    // Only submitted fields are validated, so an older or imported record
    // that predates a required field can still be corrected. FILE fields
    // aren't editable here (their stored value is an object-store key).
    const fieldDefs = await client.officeFormField.findMany({ where: { moduleId: officeModule.id } });
    const editable: DynamicFieldDef[] = fieldDefs.filter((f) => f.fieldType !== 'FILE');
    const submitted = Object.fromEntries(Object.entries(parsed.data.fields).filter(([k]) => editable.some((f) => f.key === k)));
    const fieldsParsed = buildDynamicFieldsSchema(editable).partial().safeParse(submitted);
    if (!fieldsParsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid field values', fieldsParsed.error.flatten());
      return;
    }

    const before = (record.data ?? {}) as Record<string, unknown>;
    const incoming = uppercaseFreeText(fieldsParsed.data as Record<string, unknown>, editable);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const nextData: Record<string, unknown> = { ...before };
    for (const [key, value] of Object.entries(incoming)) {
      const cleared = value === undefined || value === '';
      if (JSON.stringify(before[key] ?? null) === JSON.stringify(cleared ? null : value)) continue;
      changes[key] = { from: before[key] ?? null, to: cleared ? null : value };
      if (cleared) delete nextData[key];
      else nextData[key] = value;
    }

    let nextPerson: Record<string, unknown> | undefined;
    if (parsed.data.person) {
      if (record.personKey || !officeModule.collectPersonInfo) {
        sendError(res, 400, 'VALIDATION_ERROR', "This record is linked to a registered citizen -- ask an administrator to correct the citizen's name or birthdate");
        return;
      }
      const prev = (record.unresolvedPerson ?? {}) as Record<string, unknown>;
      const p = uppercaseStrings(parsed.data.person as Record<string, unknown>);
      nextPerson = { ...prev };
      for (const [key, value] of Object.entries(p)) {
        if (value === undefined || value === prev[key]) continue;
        changes[`person.${key}`] = { from: prev[key] ?? null, to: value };
        nextPerson[key] = value;
      }
    }

    if (Object.keys(changes).length === 0) {
      sendError(res, 400, 'NO_CHANGES', 'Nothing was changed');
      return;
    }

    const actorUserId = req.session.userId!;
    await client.officeRecord.update({
      where: { id: record.id },
      data: {
        data: nextData as Prisma.InputJsonValue,
        ...(nextPerson ? { unresolvedPerson: nextPerson as Prisma.InputJsonValue } : {}),
        updatedBy: actorUserId,
      },
    });
    await insertAuditLog(client, {
      tableName: 'OfficeRecord',
      recordId: record.id,
      action: 'update',
      actorUserId,
      actorRole: req.session.role,
      changedFields: { event: 'correction', reason: parsed.data.reason, moduleId: officeModule.id, changes } as Prisma.InputJsonValue,
    });
    res.json({ status: 'updated', changed: Object.keys(changes).length });
  }),
);

// View/download one uploaded document of a record (FILE field). Same office
// rules as the rest of this file; every access is audit-logged, since these
// are scanned IDs and civil documents.
officeRouter.get(
  '/:officeId/modules/:moduleId/records/:recordId/files/:fieldKey',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole(req.session.role!);
    const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
    if (!officeModule) {
      sendError(res, 404, 'NOT_FOUND', 'No such module');
      return;
    }
    const record = await client.officeRecord.findUnique({ where: { id: req.params.recordId } });
    const field = await client.officeFormField.findFirst({ where: { moduleId: officeModule.id, key: req.params.fieldKey, fieldType: 'FILE' } });
    const key = record && record.moduleId === officeModule.id ? (record.data as Record<string, unknown>)[req.params.fieldKey!] : undefined;
    if (!record || !field || typeof key !== 'string') {
      sendError(res, 404, 'NOT_FOUND', 'No such document');
      return;
    }
    const doc = await readDocument(key);
    if (!doc) {
      sendError(res, 404, 'NOT_FOUND', 'The document file is missing from storage');
      return;
    }
    await insertAuditLog(client, {
      tableName: 'OfficeRecord',
      recordId: record.id,
      action: 'read',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { event: 'document_view', field: field.key },
    });
    const filename = key.slice(37).replace(/[^\w.-]/g, '_') || 'document';
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(doc.body);
  }),
);

const restoreRecordSchema = z.object({
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required'),
});

// Undo an archive (e.g. the wrong record was removed). Same office rules
// and a required, audited reason, mirroring the archive route below.
officeRouter.post(
  '/:officeId/modules/:moduleId/records/:recordId/restore',
  requireOfficeAccess,
  asyncHandler(async (req, res) => {
    const parsed = restoreRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'A reason is required to restore a record', parsed.error.flatten());
      return;
    }
    const client = getPrismaForRole(req.session.role!);
    const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
    if (!officeModule) {
      sendError(res, 404, 'NOT_FOUND', 'No such module');
      return;
    }
    const record = await client.officeRecord.findUnique({ where: { id: req.params.recordId } });
    if (!record || record.moduleId !== officeModule.id || !record.isArchived) {
      sendError(res, 404, 'NOT_FOUND', 'No such archived record');
      return;
    }
    const actorUserId = req.session.userId!;
    await client.officeRecord.update({ where: { id: record.id }, data: { isArchived: false, updatedBy: actorUserId } });
    await insertAuditLog(client, {
      tableName: 'OfficeRecord',
      recordId: record.id,
      action: 'update',
      actorUserId,
      actorRole: req.session.role,
      changedFields: { event: 'restore', reason: parsed.data.reason, moduleId: officeModule.id },
    });
    res.status(204).end();
  }),
);

const archiveRecordSchema = z.object({
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required'),
});

// Soft-delete only -- office_record rows are never hard-deleted (same
// isArchived flag mergeCitizens() sets on the losing side of a merge), so a
// mistaken record can be corrected without losing the audit trail RA 10173
// and normal records-retention practice both expect from a government
// system. Works for office_staff on their own module's records and for
// admin on any module (requireOfficeAccess bypasses the office check for
// admin, same as every other route in this file).
officeRouter.delete('/:officeId/modules/:moduleId/records/:recordId', requireOfficeAccess, async (req, res) => {
  const parsed = archiveRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'A reason is required to archive a record', parsed.error.flatten());
    return;
  }

  const client = getPrismaForRole(req.session.role!);
  const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
  if (!officeModule) {
    sendError(res, 404, 'NOT_FOUND', 'No such module');
    return;
  }

  const record = await client.officeRecord.findUnique({ where: { id: req.params.recordId } });
  if (!record || record.moduleId !== officeModule.id || record.isArchived) {
    sendError(res, 404, 'NOT_FOUND', 'No such record');
    return;
  }

  const actorUserId = req.session.userId!;
  const role = req.session.role!;

  await client.officeRecord.update({
    where: { id: record.id },
    data: { isArchived: true, updatedBy: actorUserId },
  });
  await insertAuditLog(client, {
    tableName: 'OfficeRecord',
    recordId: record.id,
    action: 'delete',
    actorUserId,
    actorRole: role,
    changedFields: { reason: parsed.data.reason, moduleId: officeModule.id },
  });

  res.status(204).end();
});
