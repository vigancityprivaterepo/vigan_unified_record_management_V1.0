import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { buildDynamicFieldsSchema, type DynamicFieldDef } from '../lib/dynamicFieldSchema';
import { insertAuditLog } from '../lib/auditLog';
import { uppercaseFreeText, uppercaseStrings } from '../lib/textNormalize';
import { addHouseholdMember, designateHouseholdHead } from './households';
import { createOfficeRecord } from './officeSatelliteWriters';
import { assertNoReliefClaim, ReliefAlreadyClaimedError, type ReliefConflict } from './reliefClaims';
import { resolvePerson } from './resolvePerson';

// One intake = one submitted form for one module. Shared by the single
// registration form (routes/office.ts) and the bulk import
// (services/officeImport.ts) so both validate, match people, queue possible
// duplicates, block double relief claims and write records the same way.

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

export const coreSchema = z.object({
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

export type IntakeModule = { id: string; slug: string; requiresCitizenLink: boolean; collectPersonInfo: boolean };

export type ParsedIntake =
  | { ok: true; core: Record<string, unknown>; data: Record<string, unknown> }
  | { ok: false; message: string; details: unknown };

// Validates the person block (when the module collects one) and the
// module's own non-file fields, and applies the uppercase convention.
export function parseIntake(module: IntakeModule, jsonFieldDefs: DynamicFieldDef[], rawCore: unknown, rawFields: unknown): ParsedIntake {
  let core: Record<string, unknown> = {};
  if (module.collectPersonInfo) {
    const parsedCore = coreSchema.safeParse(rawCore);
    if (!parsedCore.success) return { ok: false, message: 'Check the person\'s details', details: parsedCore.error.flatten() };
    core = uppercaseStrings(parsedCore.data as unknown as Record<string, unknown>);
  }
  const fieldsParsed = buildDynamicFieldsSchema(jsonFieldDefs).safeParse(rawFields);
  if (!fieldsParsed.success) return { ok: false, message: 'Check the form fields', details: fieldsParsed.error.flatten() };
  return { ok: true, core, data: uppercaseFreeText(fieldsParsed.data, jsonFieldDefs) };
}

export type IntakeOutcome =
  | { kind: 'recorded'; recordId: string }
  | { kind: 'recorded_no_citizen_link'; recordId: string }
  | { kind: 'needs_review'; candidates: unknown[] }
  | { kind: 'linked'; status: 'matched' | 'created'; personKey: string; recordId: string; householdLinkWarning?: string }
  | { kind: 'already_received'; message: string; conflict: ReliefConflict };

// Writes one validated intake. Throws only on unexpected failures.
export async function submitIntake(
  client: PrismaClient,
  module: IntakeModule,
  core: Record<string, unknown>,
  data: Record<string, unknown>,
  actor: { userId: string; role: string },
): Promise<IntakeOutcome> {
  const { userId: actorUserId, role } = actor;
  const auditInsert = (tableName: string, recordId: string) =>
    insertAuditLog(client, { tableName, recordId, action: 'insert', actorUserId, actorRole: role });

  // A module that isn't about a person at all (e.g. an Assessor's "Lots").
  if (!module.collectPersonInfo) {
    const record = await createOfficeRecord(client, module.id, null, null, data, actorUserId);
    await auditInsert(record.table, record.recordId);
    return { kind: 'recorded', recordId: record.recordId };
  }

  const shouldLink = module.requiresCitizenLink || Boolean(core.linkToCitizen);
  if (!shouldLink) {
    const record = await createOfficeRecord(
      client,
      module.id,
      null,
      { lname: core.lname, fname: core.fname, mname: core.mname, bdate: core.bdate },
      data,
      actorUserId,
    );
    await auditInsert(record.table, record.recordId);
    return { kind: 'recorded_no_citizen_link', recordId: record.recordId };
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
        ${module.id}::uuid,
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
      changedFields: { moduleId: module.id, lname: core.lname as string, fname: core.fname as string },
    });
    return { kind: 'needs_review', candidates: resolveResult.candidates };
  }

  if (resolveResult.status === 'created') await auditInsert('Citizen', resolveResult.personKey);

  // Check-then-insert in one transaction: Relief Distribution refuses a
  // second claim from the same household for the same event (see
  // services/reliefClaims.ts); for every other module this is a no-op.
  const personKey = resolveResult.personKey;
  let record: Awaited<ReturnType<typeof createOfficeRecord>>;
  try {
    record = await client.$transaction(async (tx) => {
      await assertNoReliefClaim(tx, module, personKey, data);
      return createOfficeRecord(tx, module.id, personKey, null, data, actorUserId);
    });
  } catch (err) {
    if (err instanceof ReliefAlreadyClaimedError) return { kind: 'already_received', message: err.message, conflict: err.conflict };
    throw err;
  }
  await auditInsert(record.table, record.recordId);

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
      const memberResult = await addHouseholdMember(client, householdParentKey, personKey, relation, actorUserId, role);
      if (!memberResult.ok) householdLinkWarning = memberResult.message;
    }
  }

  return { kind: 'linked', status: resolveResult.status, personKey, recordId: record.recordId, householdLinkWarning };
}
