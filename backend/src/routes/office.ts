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
import { allModuleRecords, listModuleRecords, parseStatus, type RecordStatus } from '../services/officeRecordList';
import { applyDeath, undoDeath } from '../services/deathEffects';
import { parseIntake, submitIntake } from '../services/intakeSubmission';

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
    sendError(res, 404, 'NOT_FOUND', 'No such program');
    return;
  }
  const fields = await client.officeFormField.findMany({
    where: { moduleId: officeModule.id },
    select: FIELD_SELECT,
    orderBy: { sortOrder: 'asc' },
  });
  res.json(fields);
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
      sendError(res, 404, 'NOT_FOUND', 'No such program');
      return;
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
    // Person block (when the module collects one) and the module's own
    // fields -- shared with the bulk import (services/intakeSubmission.ts).
    const parsed = parseIntake(officeModule, jsonFieldDefs, req.body, rawFields);
    if (!parsed.ok) {
      sendError(res, 400, 'VALIDATION_ERROR', parsed.message, parsed.details);
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

    const data = { ...parsed.data, ...fileValues };

    try {
      const outcome = await submitIntake(client, officeModule, parsed.core, data, { userId: req.session.userId!, role: req.session.role! });
      switch (outcome.kind) {
        case 'recorded':
        case 'recorded_no_citizen_link':
          res.status(201).json({ status: outcome.kind, recordId: outcome.recordId });
          return;
        case 'needs_review':
          res.status(202).json({ status: 'needs_review', candidates: outcome.candidates });
          return;
        case 'already_received':
          sendError(res, 409, 'ALREADY_RECEIVED', outcome.message, outcome.conflict);
          return;
        case 'linked':
          res.status(201).json({
            status: outcome.status,
            personKey: outcome.personKey,
            recordId: outcome.recordId,
            householdLinkWarning: outcome.householdLinkWarning,
            deathEffects: outcome.deathEffects,
          });
          return;
      }
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
    sendError(res, 404, 'NOT_FOUND', 'No such program');
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
  review: 'Awaiting administrator review',
};

// CSV of every active record in one module, with the module's own form
// fields as columns (FILE fields left out -- they're object-store keys, not
// data). Exports carry personal data (RA 10173), so each one is audit-logged
// with who exported what and how many rows.
officeRouter.get('/:officeId/modules/:moduleId/records/export.csv', requireOfficeAccess, asyncHandler(async (req, res) => {
  const client = getPrismaForRole(req.session.role!);
  const officeModule = await requireModuleInOffice(client, req.params.officeId, req.params.moduleId);
  if (!officeModule) {
    sendError(res, 404, 'NOT_FOUND', 'No such program');
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
      sendError(res, 404, 'NOT_FOUND', 'No such program');
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
        sendError(res, 400, 'VALIDATION_ERROR', "This record is linked to a registered citizen. Ask an administrator to correct the citizen's name or birthdate");
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
      sendError(res, 404, 'NOT_FOUND', 'No such program');
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
      sendError(res, 404, 'NOT_FOUND', 'No such program');
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
    await applyDeath(client, record.id, { userId: actorUserId, role: req.session.role! });
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
    sendError(res, 404, 'NOT_FOUND', 'No such program');
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
  // A death record archived as a mistake puts the person back (services/deathEffects.ts).
  await undoDeath(client, record.id, { userId: actorUserId, role });

  res.status(204).end();
});
