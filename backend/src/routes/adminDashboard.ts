import { Router } from 'express';
import { z } from 'zod';
import { decryptField, encryptField } from '../lib/encryption';
import { asyncHandler } from '../lib/asyncHandler';
import { insertAuditLog } from '../lib/auditLog';
import { sendCsv } from '../lib/csv';
import { sendError } from '../lib/errors';
import { parsePage } from '../lib/pagination';
import { getPrismaForRole } from '../lib/prismaByRole';
import { requireRole } from '../middleware/auth';
import { addHouseholdMember, designateHouseholdHead } from '../services/households';
import { categoriesForPersonKeys } from '../services/insights';

export const adminDashboardRouter = Router();
adminDashboardRouter.use(requireRole('admin'));

// --- KPI summary strip -------------------------------------------------------

adminDashboardRouter.get('/dashboard/summary', async (_req, res) => {
  const client = getPrismaForRole('admin');
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [citizenCount, officeCount, moduleCount, recordsThisMonth] = await Promise.all([
    client.citizen.count({ where: { isArchived: false } }),
    client.office.count({ where: { isActive: true } }),
    client.officeModule.count(),
    client.officeRecord.count({ where: { isArchived: false, createdAt: { gte: monthStart } } }),
  ]);

  res.json({ citizenCount, officeCount, moduleCount, recordsThisMonth });
});

// --- Citizen search + 360 view ----------------------------------------------

const CITIZEN_LIST_SELECT = {
  personKey: true,
  personLname: true,
  personFname: true,
  personMname: true,
  personBdate: true,
  personIsHead: true,
  isArchived: true,
  barangay: { select: { name: true } },
} as const;

const CITIZENS_PAGE_SIZE = 20;

adminDashboardRouter.get('/citizens', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = parsePage(req.query.page);
  const client = getPrismaForRole('admin');

  const where = q
    ? {
        OR: [
          { personLname: { contains: q, mode: 'insensitive' as const } },
          { personFname: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : undefined;

  const [total, citizens] = await Promise.all([
    client.citizen.count({ where }),
    client.citizen.findMany({
      where,
      select: CITIZEN_LIST_SELECT,
      orderBy: [{ personLname: 'asc' }, { personFname: 'asc' }],
      skip: (page - 1) * CITIZENS_PAGE_SIZE,
      take: CITIZENS_PAGE_SIZE,
    }),
  ]);

  // Which offices serve each listed citizen, for the colored dots on the
  // Citizens list.
  const records = citizens.length
    ? await client.officeRecord.findMany({
        where: { personKey: { in: citizens.map((c) => c.personKey) }, isArchived: false },
        select: { personKey: true, module: { select: { office: { select: { id: true, name: true, accentHue: true, icon: true } } } } },
      })
    : [];
  const officesByPerson = new Map<string, Map<string, { id: string; name: string; accentHue: number; icon: string }>>();
  for (const r of records) {
    if (!r.personKey) continue;
    const m = officesByPerson.get(r.personKey) ?? new Map();
    m.set(r.module.office.id, r.module.office);
    officesByPerson.set(r.personKey, m);
  }

  res.json({
    items: citizens.map((c) => ({ ...c, offices: [...(officesByPerson.get(c.personKey)?.values() ?? [])] })),
    total,
    page,
    pageSize: CITIZENS_PAGE_SIZE,
  });
});

// Citizen masterlist CSV: every active (non-merged) Citizen's core identity
// plus which offices serve them. Never includes the encrypted government ID
// columns. Audit-logged like every other personal-data export.
adminDashboardRouter.get(
  '/citizens/export.csv',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    const [citizens, offices] = await Promise.all([
      client.citizen.findMany({
        where: { isArchived: false },
        select: {
          personKey: true,
          personLname: true,
          personFname: true,
          personMname: true,
          personSex: true,
          personBdate: true,
          personCivilStatus: true,
          personStreet: true,
          barangay: { select: { name: true } },
        },
        orderBy: [{ personLname: 'asc' }, { personFname: 'asc' }],
      }),
      client.$queryRaw<Array<{ person_key: string; offices: string }>>`
        SELECT r.person_key, string_agg(DISTINCT o.name, '; ' ORDER BY o.name) AS offices
        FROM office_record r
        JOIN office_module m ON m.id = r.module_id
        JOIN office o ON o.id = m.office_id
        WHERE r.is_archived = false AND r.person_key IS NOT NULL
        GROUP BY r.person_key`,
    ]);
    const officesByKey = new Map(offices.map((o) => [o.person_key, o.offices]));

    await insertAuditLog(client, {
      tableName: 'Citizen',
      action: 'read',
      actorUserId: req.session.userId,
      actorRole: req.session.role,
      changedFields: { event: 'export_csv', kind: 'masterlist', rowCount: citizens.length },
    });

    sendCsv(
      res,
      `citizen-masterlist-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Last name', 'First name', 'Middle name', 'Sex', 'Birthdate', 'Civil status', 'Street', 'Barangay', 'Offices'],
      citizens.map((c) => [
        c.personLname,
        c.personFname,
        c.personMname,
        c.personSex,
        c.personBdate,
        c.personCivilStatus,
        c.personStreet,
        c.barangay?.name,
        officesByKey.get(c.personKey),
      ]),
    );
  }),
);

// Aggregates every office's data for one person_key onto one screen --
// that's the entire point of a Citizen record: offices never duplicate the
// person, they each hold their own office_record rows against the same key.
adminDashboardRouter.get('/citizens/:personKey', async (req, res) => {
  const client = getPrismaForRole('admin');
  const personKey = req.params.personKey;

  const citizen = await client.citizen.findUnique({
    where: { personKey },
    select: {
      personKey: true,
      personParentKey: true,
      personSubParentKey: true,
      personIsHead: true,
      personRelationToHead: true,
      personLname: true,
      personFname: true,
      personMname: true,
      personStreet: true,
      personSex: true,
      personGender: true,
      personBdate: true,
      personCivilStatus: true,
      personReligion: true,
      personEducLevel: true,
      personEducCourse: true,
      personOccupation: true,
      personOccupationIndustry: true,
      personOccupationBusName: true,
      personOccupationBusAddress: true,
      personSssEnc: true,
      personGsisEnc: true,
      personPhilhealthEnc: true,
      createdAt: true,
      updatedAt: true,
      isArchived: true,
      barangay: { select: { code: true, name: true } },
      parent: { select: { personKey: true, personLname: true, personFname: true } },
    },
  });

  if (!citizen) {
    sendError(res, 404, 'NOT_FOUND', 'No citizen with that person_key');
    return;
  }

  const officeRecords = await client.officeRecord.findMany({
    where: { personKey, isArchived: false },
    select: {
      id: true,
      data: true,
      createdAt: true,
      module: {
        select: {
          id: true,
          name: true,
          slug: true,
          office: { select: { id: true, name: true, slug: true, accentHue: true, icon: true } },
          // Labels + types so the 360 view can summarize each record's data.
          formFields: { select: { key: true, label: true, fieldType: true }, orderBy: { sortOrder: 'asc' } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // The household this person belongs to (as head or member), flat.
  const headKey = citizen.personIsHead ? citizen.personKey : citizen.personParentKey;
  const household = headKey
    ? await client.citizen.findMany({
        where: { OR: [{ personKey: headKey }, { personParentKey: headKey }], isArchived: false },
        select: { personKey: true, personLname: true, personFname: true, personMname: true, personIsHead: true, personRelationToHead: true },
        orderBy: [{ personIsHead: 'desc' }, { personLname: 'asc' }],
      })
    : [];

  const {
    personSssEnc,
    personGsisEnc,
    personPhilhealthEnc,
    ...citizenWithoutEncryptedFields
  } = citizen;

  // Ciphertext itself never leaves the server -- only the decrypted value
  // (admin-only route, same trust level the spec gives the Citizen 360
  // view). decryptField throws on a wrong/rotated key or corrupted data;
  // caught per-field so one bad value can't 500 the whole profile.
  function safeDecrypt(blob: Buffer | null): string | null {
    if (!blob) return null;
    try {
      return decryptField(blob);
    } catch {
      return null;
    }
  }

  // Recorded so the citizen's access history (Privacy) shows who opened it.
  await insertAuditLog(client, {
    tableName: 'Citizen', recordId: citizen.personKey, action: 'read', actorUserId: req.session.userId, actorRole: req.session.role,
    changedFields: { event: 'profile_view' },
  });
  res.json({
    citizen: {
      ...citizenWithoutEncryptedFields,
      sss: safeDecrypt(personSssEnc),
      gsis: safeDecrypt(personGsisEnc),
      philhealth: safeDecrypt(personPhilhealthEnc),
    },
    officeRecords,
    household,
  });
});

const governmentIdsSchema = z.object({
  sss: z.string().trim().min(1).optional(),
  gsis: z.string().trim().min(1).optional(),
  philhealth: z.string().trim().min(1).optional(),
});

// Encrypts each provided value before it ever reaches Postgres -- plaintext
// SSS/GSIS/PhilHealth numbers never appear in a SQL statement. Only the
// fields present in the request body are touched; omitted ones are left
// as-is (this is a partial update, not a full-record replace).
adminDashboardRouter.patch('/citizens/:personKey/government-ids', async (req, res) => {
  const parsed = governmentIdsSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid government IDs payload', parsed.error.flatten());
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Provide at least one of sss, gsis, philhealth');
    return;
  }

  const client = getPrismaForRole('admin');
  const personKey = req.params.personKey;
  const actorUserId = req.session.userId!;

  const existing = await client.citizen.findUnique({ where: { personKey }, select: { personKey: true } });
  if (!existing) {
    sendError(res, 404, 'NOT_FOUND', 'No citizen with that person_key');
    return;
  }

  await client.citizen.update({
    where: { personKey },
    data: {
      personSssEnc: parsed.data.sss !== undefined ? encryptField(parsed.data.sss) : undefined,
      personGsisEnc: parsed.data.gsis !== undefined ? encryptField(parsed.data.gsis) : undefined,
      personPhilhealthEnc: parsed.data.philhealth !== undefined ? encryptField(parsed.data.philhealth) : undefined,
      updatedBy: actorUserId,
    },
    select: { personKey: true },
  });

  // Which fields changed, never the values themselves -- audit_log is
  // append-only and admin-readable, not a place to also store plaintext IDs.
  await insertAuditLog(client, {
    tableName: 'Citizen',
    recordId: personKey,
    action: 'update',
    actorUserId,
    actorRole: 'admin',
    changedFields: { fields: Object.keys(parsed.data) },
  });

  res.status(204).send();
});

// --- Household view ----------------------------------------------------------

const HOUSEHOLDS_PAGE_SIZE = 20;

adminDashboardRouter.get('/households', async (req, res) => {
  const client = getPrismaForRole('admin');
  const page = parsePage(req.query.page);
  // ?q= finds a household by its head's OR any member's last/first name, so
  // staff updating one member can jump straight to that person's household.
  // A person_key (uuid) matches the head or a member exactly -- that's how
  // the Citizens profile links to a household.
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const isKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  const nameMatch = (term: string) => ({
    OR: [
      { personLname: { contains: term, mode: 'insensitive' as const } },
      { personFname: { contains: term, mode: 'insensitive' as const } },
    ],
  });
  const memberMatch = isKey ? { personKey: q } : q ? nameMatch(q) : undefined;
  const where = {
    personIsHead: true,
    isArchived: false,
    ...(memberMatch
      ? { OR: [memberMatch, { children: { some: { ...memberMatch, isArchived: false } } }] }
      : {}),
  };

  const [total, heads] = await Promise.all([
    client.citizen.count({ where }),
    client.citizen.findMany({
      where,
      select: {
        personKey: true,
        personLname: true,
        personFname: true,
        barangay: { select: { name: true } },
        _count: { select: { children: true } },
        // Members that matched the search, so the list can say why this
        // household came up ("Includes Maria Reyes").
        ...(memberMatch
          ? {
              children: {
                where: { ...memberMatch, isArchived: false },
                select: { personFname: true, personLname: true },
                take: 3,
              },
            }
          : {}),
      },
      orderBy: [{ personLname: 'asc' }],
      skip: (page - 1) * HOUSEHOLDS_PAGE_SIZE,
      take: HOUSEHOLDS_PAGE_SIZE,
    }),
  ]);

  res.json({
    items: heads.map((h) => ({
      personKey: h.personKey,
      personLname: h.personLname,
      personFname: h.personFname,
      barangayName: h.barangay?.name ?? null,
      memberCount: h._count.children + 1, // +1 for the head itself
      matchedMembers: 'children' in h ? h.children.map((c) => `${c.personFname} ${c.personLname}`) : [],
    })),
    total,
    page,
    pageSize: HOUSEHOLDS_PAGE_SIZE,
  });
});

const householdMemberSelect = {
  personKey: true,
  personLname: true,
  personFname: true,
  personMname: true,
  personBdate: true,
  personRelationToHead: true,
  personSubParentKey: true,
} as const;

adminDashboardRouter.get('/households/:headPersonKey', async (req, res) => {
  const client = getPrismaForRole('admin');
  const headPersonKey = req.params.headPersonKey;

  const head = await client.citizen.findUnique({
    where: { personKey: headPersonKey },
    select: { ...householdMemberSelect, personIsHead: true, barangay: { select: { name: true } } },
  });
  if (!head || !head.personIsHead) {
    sendError(res, 404, 'NOT_FOUND', 'No household with that head person_key');
    return;
  }

  // Grouped by person_parent_key / person_sub_parent_key, per spec -- every
  // citizen pointing at this head is a member; those additionally pointing
  // at a sub_parent_key are nested under that intermediate member (e.g. a
  // grandchild grouped under their own parent within the same household).
  const members = await client.citizen.findMany({
    where: { personParentKey: headPersonKey },
    select: householdMemberSelect,
    orderBy: [{ personLname: 'asc' }],
  });

  // Which offices have touched each member -- Birth/Death included here,
  // unlike the Insights Sankey's combinatorial-overlap view, since this is
  // "everything on file for this person," not a membership-overlap story.
  const categoriesByPerson = await categoriesForPersonKeys(client, [headPersonKey, ...members.map((m) => m.personKey)]);

  await insertAuditLog(client, {
    tableName: 'Citizen', recordId: headPersonKey, action: 'read', actorUserId: req.session.userId, actorRole: req.session.role,
    changedFields: { event: 'household_view', personKeys: [headPersonKey, ...members.map((m) => m.personKey)] },
  });
  res.json({
    head: { ...head, barangayName: head.barangay?.name ?? null, categories: categoriesByPerson.get(headPersonKey) ?? [] },
    members: members.map((m) => ({ ...m, categories: categoriesByPerson.get(m.personKey) ?? [] })),
  });
});

const createHouseholdSchema = z.object({ headPersonKey: z.string().uuid() });

// Maps a households-service failure code to an HTTP status -- shared by
// every route below so the mapping only lives in one place.
function statusForHouseholdOpCode(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'VALIDATION_ERROR') return 400;
  return 409; // ALREADY_HEAD, ALREADY_IN_HOUSEHOLD
}

// Designates an existing Citizen as a household head -- households aren't a
// separate table (see the Citizen model's person_parent_key/person_is_head
// columns), so "creating" one just flips this flag on a citizen who's
// already on file from some office's intake. No new Citizen is ever
// created here.
adminDashboardRouter.post('/households', async (req, res) => {
  const parsed = createHouseholdSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid payload', parsed.error.flatten());
    return;
  }
  const client = getPrismaForRole('admin');
  const { headPersonKey } = parsed.data;
  const actorUserId = req.session.userId!;

  const citizen = await client.citizen.findUnique({ where: { personKey: headPersonKey }, select: { personIsHead: true } });
  if (citizen?.personIsHead) {
    sendError(res, 409, 'ALREADY_HEAD', 'This person is already a household head');
    return;
  }

  const result = await designateHouseholdHead(client, headPersonKey, actorUserId, 'admin');
  if (!result.ok) {
    sendError(res, statusForHouseholdOpCode(result.code), result.code, result.message);
    return;
  }

  res.status(201).json({ headPersonKey });
});

const addMemberSchema = z.object({
  personKey: z.string().uuid(),
  relationToHead: z.string().trim().min(1).max(60),
});

// Links an existing Citizen into a household as a member.
adminDashboardRouter.post('/households/:headPersonKey/members', async (req, res) => {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid payload', parsed.error.flatten());
    return;
  }
  const client = getPrismaForRole('admin');
  const headPersonKey = req.params.headPersonKey;
  const { personKey, relationToHead } = parsed.data;
  const actorUserId = req.session.userId!;

  const result = await addHouseholdMember(client, headPersonKey, personKey, relationToHead, actorUserId, 'admin');
  if (!result.ok) {
    sendError(res, statusForHouseholdOpCode(result.code), result.code, result.message);
    return;
  }

  res.status(201).json({ personKey, headPersonKey, relationToHead });
});

// Un-links a member -- soft in the sense that the member's own Citizen
// record is untouched, just no longer attached to this household. Doesn't
// require the household to be empty first (that's only enforced when
// disbanding the household itself, below).
adminDashboardRouter.delete('/households/:headPersonKey/members/:personKey', async (req, res) => {
  const client = getPrismaForRole('admin');
  const { headPersonKey, personKey } = req.params;
  const actorUserId = req.session.userId!;

  const member = await client.citizen.findUnique({
    where: { personKey },
    select: { personParentKey: true },
  });
  if (!member || member.personParentKey !== headPersonKey) {
    sendError(res, 404, 'NOT_FOUND', 'This person is not a member of that household');
    return;
  }

  await client.citizen.update({
    where: { personKey },
    data: { personParentKey: null, personRelationToHead: null, updatedBy: actorUserId },
    select: { personKey: true },
  });
  await insertAuditLog(client, {
    tableName: 'Citizen',
    recordId: personKey,
    action: 'update',
    actorUserId,
    actorRole: 'admin',
    changedFields: { personParentKey: null, personRelationToHead: null, removedFromHousehold: headPersonKey },
  });

  res.status(204).send();
});

// Disbands a household (un-heads the citizen) -- only once every member has
// been removed, so a member row can never be left pointing at a
// person_parent_key that isn't a head anymore.
adminDashboardRouter.delete('/households/:headPersonKey', async (req, res) => {
  const client = getPrismaForRole('admin');
  const headPersonKey = req.params.headPersonKey;
  const actorUserId = req.session.userId!;

  const head = await client.citizen.findUnique({
    where: { personKey: headPersonKey },
    select: { personIsHead: true, _count: { select: { children: true } } },
  });
  if (!head || !head.personIsHead) {
    sendError(res, 404, 'NOT_FOUND', 'No household with that head person_key');
    return;
  }
  if (head._count.children > 0) {
    sendError(res, 409, 'HOUSEHOLD_HAS_MEMBERS', 'Remove every member before disbanding this household', {
      memberCount: head._count.children,
    });
    return;
  }

  await client.citizen.update({
    where: { personKey: headPersonKey },
    data: { personIsHead: false, updatedBy: actorUserId },
    select: { personKey: true },
  });
  await insertAuditLog(client, {
    tableName: 'Citizen',
    recordId: headPersonKey,
    action: 'update',
    actorUserId,
    actorRole: 'admin',
    changedFields: { personIsHead: false },
  });

  res.status(204).send();
});

