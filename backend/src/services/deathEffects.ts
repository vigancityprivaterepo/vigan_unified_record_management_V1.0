import type { Prisma, PrismaClient } from '@prisma/client';
import { insertAuditLog } from '../lib/auditLog';

// What happens to the rest of the registry when Civil Registry records a
// death (a record in a module with slug 'death', linked to a citizen):
//
//   1. The person leaves their household. If they headed it, the surviving
//      spouse becomes head, or else the oldest adult, or else the oldest
//      member, and the other members move under the new head.
//   2. A surviving spouse marked Married becomes Widowed.
//   3. The person is taken off the program lists the city has said to clean
//      up: the target program of every active "Deceased still on ... list"
//      rule (Program gaps, kind 'conflict', sourced from Death). Those
//      records are archived, not deleted. Records of things that happened
//      (a consultation, assistance released, a tax payment) are left alone,
//      because they stay true.
//   4. The person no longer shows in the Citizens list (see ALIVE below).
//
// The Death record itself is untouched and stays in the Death program.
// Everything changed is noted on the death record under `_effects`, so
// archiving that record (entered by mistake) puts it all back, except that
// a household keeps its new head and the person returns as a member.

export const DEATH_SLUG = 'death';

// Prisma filter: citizens with no (non-archived) death record.
export const ALIVE = { officeRecords: { none: { isArchived: false, module: { slug: DEATH_SLUG } } } } as const;

type Actor = { userId: string; role: string };

type StoredEffects = {
  archivedRecordIds: string[];
  household: null | { headKey: string; wasHead: boolean; relation: string | null; subParentKey: string | null };
  widowed: null | { personKey: string; was: string };
};

export type DeathEffects = {
  // Program names the person was taken off.
  removedFrom: string[];
  // "Left the household of X" / who heads it now.
  household: null | { head: string; newHead: boolean };
};

const isSpouse = (relation: string | null) => /spouse|wife|husband/i.test(relation ?? '');
const fullName = (c: { personFname: string; personLname: string }) => `${c.personFname} ${c.personLname}`;

async function inTransaction<T>(client: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return client.$transaction(fn);
}

// Safe to call after any record is created, linked or restored: does nothing
// unless it is a death record linked to a citizen that has not been applied yet.
export async function applyDeath(client: PrismaClient, deathRecordId: string, actor: Actor): Promise<DeathEffects | null> {
  const record = await client.officeRecord.findUnique({
    where: { id: deathRecordId },
    select: { personKey: true, isArchived: true, data: true, module: { select: { slug: true } } },
  });
  if (!record || record.module.slug !== DEATH_SLUG || !record.personKey || record.isArchived) return null;
  const data = (record.data ?? {}) as Record<string, unknown>;
  if (data._effects) return null;
  const personKey = record.personKey;

  return inTransaction(client, async (tx) => {
    const audit = (tableName: string, recordId: string, action: 'update' | 'delete', changedFields: Record<string, unknown>) =>
      insertAuditLog(tx, { tableName, recordId, action, actorUserId: actor.userId, actorRole: actor.role, changedFields: { event: 'death_recorded', deathRecordId, ...changedFields } as Prisma.InputJsonValue });

    // 3. Program lists to clean up.
    const deathModules = await tx.officeModule.findMany({ where: { slug: DEATH_SLUG }, select: { id: true } });
    const rules = await tx.programGapRule.findMany({
      where: { kind: 'conflict', isActive: true, sourceModuleIds: { hasSome: deathModules.map((m) => m.id) } },
      select: { targetModuleId: true },
    });
    const listed = await tx.officeRecord.findMany({
      where: { personKey, isArchived: false, moduleId: { in: rules.map((r) => r.targetModuleId) } },
      select: { id: true, moduleId: true, module: { select: { name: true } } },
    });
    for (const r of listed) {
      await tx.officeRecord.update({ where: { id: r.id }, data: { isArchived: true, updatedBy: actor.userId }, select: { id: true } });
      await audit('OfficeRecord', r.id, 'delete', { reason: 'Death recorded by Civil Registry', moduleId: r.moduleId });
    }

    // 1 + 2. Household.
    const person = await tx.citizen.findUnique({
      where: { personKey },
      select: { personIsHead: true, personParentKey: true, personSubParentKey: true, personRelationToHead: true },
    });
    let household: StoredEffects['household'] = null;
    let widowed: StoredEffects['widowed'] = null;
    let shown: DeathEffects['household'] = null;
    const widow = async (spouse: { personKey: string; personCivilStatus: string | null }) => {
      if (spouse.personCivilStatus?.toLowerCase() !== 'married') return;
      await tx.citizen.update({ where: { personKey: spouse.personKey }, data: { personCivilStatus: 'Widowed', updatedBy: actor.userId }, select: { personKey: true } });
      await audit('Citizen', spouse.personKey, 'update', { personCivilStatus: { from: spouse.personCivilStatus, to: 'Widowed' } });
      widowed = { personKey: spouse.personKey, was: spouse.personCivilStatus };
    };

    if (person?.personIsHead) {
      const members = await tx.citizen.findMany({
        where: { personParentKey: personKey, isArchived: false },
        select: { personKey: true, personFname: true, personLname: true, personBdate: true, personRelationToHead: true, personCivilStatus: true, officeRecords: { where: { isArchived: false, module: { slug: DEATH_SLUG } }, select: { id: true }, take: 1 } },
        orderBy: { personBdate: 'asc' },
      });
      const living = members.filter((m) => m.officeRecords.length === 0);
      const adult = (m: (typeof living)[number]) => m.personBdate !== null && m.personBdate.getTime() <= Date.now() - 18 * 365.25 * 86_400_000;
      const successor = living.find((m) => isSpouse(m.personRelationToHead) && adult(m)) ?? living.find(adult) ?? living[0];
      if (successor) {
        await tx.citizen.update({ where: { personKey: successor.personKey }, data: { personIsHead: true, personParentKey: null, personRelationToHead: 'Head', updatedBy: actor.userId }, select: { personKey: true } });
        await tx.citizen.updateMany({ where: { personParentKey: personKey, personKey: { not: successor.personKey } }, data: { personParentKey: successor.personKey, updatedBy: actor.userId } });
        await audit('Citizen', successor.personKey, 'update', { personIsHead: true, householdHeadBefore: personKey });
        if (isSpouse(successor.personRelationToHead)) await widow(successor);
        household = { headKey: successor.personKey, wasHead: true, relation: person.personRelationToHead, subParentKey: null };
        shown = { head: fullName(successor), newHead: true };
      }
      await tx.citizen.update({ where: { personKey }, data: { personIsHead: false, updatedBy: actor.userId }, select: { personKey: true } });
    } else if (person?.personParentKey) {
      const head = await tx.citizen.findUnique({ where: { personKey: person.personParentKey }, select: { personKey: true, personFname: true, personLname: true, personCivilStatus: true } });
      await tx.citizen.update({ where: { personKey }, data: { personParentKey: null, personSubParentKey: null, updatedBy: actor.userId }, select: { personKey: true } });
      household = { headKey: person.personParentKey, wasHead: false, relation: person.personRelationToHead, subParentKey: person.personSubParentKey };
      if (head) {
        shown = { head: fullName(head), newHead: false };
        if (isSpouse(person.personRelationToHead)) await widow(head);
      }
    }

    const effects: StoredEffects = { archivedRecordIds: listed.map((r) => r.id), household, widowed };
    await tx.officeRecord.update({ where: { id: deathRecordId }, data: { data: { ...data, _effects: effects } as Prisma.InputJsonValue }, select: { id: true } });
    await audit('Citizen', personKey, 'update', { leftHousehold: household?.headKey ?? null, removedFromPrograms: listed.map((r) => r.moduleId) });
    return { removedFrom: [...new Set(listed.map((r) => r.module.name))], household: shown };
  });
}

// For a person whose death record arrived another way (duplicate review,
// where the record is created and then moved to the citizen it matched).
export async function applyDeathsFor(client: PrismaClient, personKey: string, actor: Actor): Promise<void> {
  const records = await client.officeRecord.findMany({ where: { personKey, isArchived: false, module: { slug: DEATH_SLUG } }, select: { id: true } });
  for (const r of records) await applyDeath(client, r.id, actor);
}

// The death record was entered by mistake and has just been archived: put
// back what applyDeath changed. Does nothing for any other record.
export async function undoDeath(client: PrismaClient, deathRecordId: string, actor: Actor): Promise<boolean> {
  const record = await client.officeRecord.findUnique({ where: { id: deathRecordId }, select: { personKey: true, data: true, module: { select: { slug: true } } } });
  const data = (record?.data ?? {}) as Record<string, unknown>;
  const effects = data._effects as StoredEffects | undefined;
  if (!record || record.module.slug !== DEATH_SLUG || !record.personKey || !effects) return false;
  const personKey = record.personKey;

  await inTransaction(client, async (tx) => {
    const audit = (tableName: string, recordId: string, changedFields: Record<string, unknown>) =>
      insertAuditLog(tx, { tableName, recordId, action: 'update', actorUserId: actor.userId, actorRole: actor.role, changedFields: { event: 'death_record_withdrawn', deathRecordId, ...changedFields } as Prisma.InputJsonValue });

    const archived = await tx.officeRecord.findMany({ where: { id: { in: effects.archivedRecordIds ?? [] }, isArchived: true }, select: { id: true } });
    for (const r of archived) {
      await tx.officeRecord.update({ where: { id: r.id }, data: { isArchived: false, updatedBy: actor.userId }, select: { id: true } });
      await audit('OfficeRecord', r.id, { restored: true });
    }

    const person = await tx.citizen.findUnique({ where: { personKey }, select: { personIsHead: true, personParentKey: true } });
    if (effects.household && person && !person.personIsHead && !person.personParentKey) {
      // Whoever heads that household today (the head may have changed since).
      const then = await tx.citizen.findUnique({ where: { personKey: effects.household.headKey }, select: { personKey: true, personIsHead: true, personParentKey: true, isArchived: true } });
      const headKey = then && !then.isArchived ? (then.personIsHead ? then.personKey : then.personParentKey) : null;
      if (headKey) {
        const sub = effects.household.subParentKey ? await tx.citizen.findUnique({ where: { personKey: effects.household.subParentKey }, select: { personKey: true } }) : null;
        await tx.citizen.update({
          where: { personKey },
          data: { personParentKey: headKey, personSubParentKey: sub?.personKey ?? null, personRelationToHead: effects.household.wasHead ? null : effects.household.relation, updatedBy: actor.userId },
          select: { personKey: true },
        });
        await audit('Citizen', personKey, { rejoinedHousehold: headKey });
      }
    }
    if (effects.widowed) {
      const spouse = await tx.citizen.findUnique({ where: { personKey: effects.widowed.personKey }, select: { personCivilStatus: true } });
      if (spouse?.personCivilStatus === 'Widowed') {
        await tx.citizen.update({ where: { personKey: effects.widowed.personKey }, data: { personCivilStatus: effects.widowed.was, updatedBy: actor.userId }, select: { personKey: true } });
        await audit('Citizen', effects.widowed.personKey, { personCivilStatus: { from: 'Widowed', to: effects.widowed.was } });
      }
    }
    const rest = { ...data };
    delete rest._effects;
    await tx.officeRecord.update({ where: { id: deathRecordId }, data: { data: rest as Prisma.InputJsonValue }, select: { id: true } });
  });
  return true;
}
