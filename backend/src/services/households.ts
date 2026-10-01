import type { Prisma, PrismaClient } from '@prisma/client';
import { insertAuditLog } from '../lib/auditLog';

type Client = PrismaClient | Prisma.TransactionClient;

export type HouseholdOpResult = { ok: true } | { ok: false; code: string; message: string };

// Designates an existing citizen as a household head -- idempotent (still
// ok:true) if they already are one, since callers like the Birth intake's
// household link (office.ts) shouldn't treat "parent already heads a
// household" as a failure, just a no-op.
export async function designateHouseholdHead(
  client: Client,
  personKey: string,
  actorUserId: string,
  actorRole: string,
): Promise<HouseholdOpResult> {
  const citizen = await client.citizen.findUnique({
    where: { personKey },
    select: { personIsHead: true, isArchived: true },
  });
  if (!citizen || citizen.isArchived) {
    return { ok: false, code: 'NOT_FOUND', message: 'No citizen with that person_key' };
  }
  if (citizen.personIsHead) return { ok: true };

  await client.citizen.update({
    where: { personKey },
    data: { personIsHead: true, updatedBy: actorUserId },
    select: { personKey: true },
  });
  await insertAuditLog(client, {
    tableName: 'Citizen',
    recordId: personKey,
    action: 'update',
    actorUserId,
    actorRole,
    changedFields: { personIsHead: true },
  });
  return { ok: true };
}

// Links an existing citizen into a household as a member -- shared by
// admin's Households page (adminDashboard.ts) and any office's intake flow
// that wants to establish the link at the moment of registration (see
// office.ts's Birth-module household link). Kept to one flat level
// (person_parent_key only); person_sub_parent_key isn't set here since
// nothing today needs it -- the read side already handles it if it's ever
// populated some other way.
export async function addHouseholdMember(
  client: Client,
  headPersonKey: string,
  memberPersonKey: string,
  relationToHead: string,
  actorUserId: string,
  actorRole: string,
): Promise<HouseholdOpResult> {
  if (memberPersonKey === headPersonKey) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'A household head cannot also be their own member' };
  }

  const head = await client.citizen.findUnique({ where: { personKey: headPersonKey }, select: { personIsHead: true } });
  if (!head || !head.personIsHead) {
    return { ok: false, code: 'NOT_FOUND', message: 'No household with that head person_key' };
  }

  const member = await client.citizen.findUnique({
    where: { personKey: memberPersonKey },
    select: { personIsHead: true, personParentKey: true, isArchived: true },
  });
  if (!member || member.isArchived) {
    return { ok: false, code: 'NOT_FOUND', message: 'No citizen with that person_key' };
  }
  if (member.personIsHead) {
    return { ok: false, code: 'ALREADY_HEAD', message: 'This person heads their own household -- remove that first' };
  }
  if (member.personParentKey) {
    return {
      ok: false,
      code: 'ALREADY_IN_HOUSEHOLD',
      message:
        member.personParentKey === headPersonKey
          ? 'This person is already a member of this household'
          : 'This person already belongs to another household',
    };
  }

  await client.citizen.update({
    where: { personKey: memberPersonKey },
    data: { personParentKey: headPersonKey, personRelationToHead: relationToHead, updatedBy: actorUserId },
    select: { personKey: true },
  });
  await insertAuditLog(client, {
    tableName: 'Citizen',
    recordId: memberPersonKey,
    action: 'update',
    actorUserId,
    actorRole,
    changedFields: { personParentKey: headPersonKey, personRelationToHead: relationToHead },
  });
  return { ok: true };
}
