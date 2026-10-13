import { Prisma, type PrismaClient } from '@prisma/client';
import { env } from '../env';
import { insertAuditLog } from '../lib/auditLog';
import { uppercaseStrings } from '../lib/textNormalize';
import { getSetting, setSetting } from './config';
import { DEATH_SLUG } from './deathEffects';
import { addHouseholdMember, designateHouseholdHead } from './households';
import { submitIntake } from './intakeSubmission';
import { createOfficeRecord } from './officeSatelliteWriters';
import { resolvePerson } from './resolvePerson';

// Pulls released assistance from the AICS system (CSWD's own case system)
// into the registry, so the Assistance page counts real AICS releases and
// nobody encodes a case twice. The contract is integrations/aics/openapi.yaml;
// AICS serves it at /api/integration/v1.
//
// Each run asks AICS for the releases changed since the last run and, for
// each one not seen before:
//   - looks up the AICS client and puts them through the same matching as a
//     registration form (resolvePerson): matched to a citizen, added as a new
//     citizen, or sent to Duplicate review when the name is only close;
//     a matched citizen's empty details are filled from AICS, never replaced;
//   - writes one record in the AICS program (module slug 'aics'), dated the
//     day AICS released it, tagged `_aics_case_id` so it is never counted twice.
// A release AICS later archived or cancelled is archived here too, and one
// AICS corrected (amount, type, date) is corrected here.
//
// The client's family composition in AICS becomes their household here: the
// client heads it and each family member is matched or added the same way
// and linked as a member. One with no date of birth in AICS, or whose name is
// close to somebody else's, is added all the same and shows under possible
// duplicates (duplicateCitizens.ts) for the administrator to confirm or
// merge. Nobody is moved out of a household they are already in, and nobody
// is ever removed. A client whose
// AICS profile changes later is brought up to date on the next run.
//
// A client AICS has marked as a senior citizen, a PWD, a solo parent or a 4Ps
// beneficiary is put on that CSWD program's list here (PROGRAM_OF below), if
// the program exists and the citizen has never been on it. The record holds
// no ID number or other detail: CSWD completes it. Add only: unticking the
// mark in AICS takes nobody off a list, and someone CSWD removed is not put back.
//
// A burial release also records the death in Civil Registry's Death program
// (slug 'death'), so that office does not encode it again. AICS knows the
// deceased's name and age but not their date of birth, and a name alone does
// not identify a person (see registryLinking.ts), so the record is saved
// under the name, not linked to a citizen: nobody is marked deceased until
// Civil Registry links the record (Link to registry), which then applies
// deathEffects.ts. A death Civil Registry already has (same name, same day)
// is not recorded twice.
//
// Read-only towards AICS. Off unless AICS_BRIDGE_URL and AICS_BRIDGE_KEY are set.

export const AICS_SLUG = 'aics';
// "Created by" on everything the bridge writes (there is no staff account behind it).
export const AICS_BRIDGE_ACTOR = 'a1c5b21d-9e00-4d00-8000-000000000001';
const STATE_KEY = 'AICS_BRIDGE_STATE';
const ACTOR = { userId: AICS_BRIDGE_ACTOR, role: 'aics_bridge' };

type Release = {
  id: string; caseNumber: string | null; clientId: string; assistanceType: string; amount: number | null; releasedAt: string;
  beneficiaryIsClient: boolean; beneficiaryName: string | null; beneficiaryRelationship: string | null; withdrawn: boolean; updatedAt: string;
  deceased?: { name: string; age: number | null; sex: string | null; civilStatus: string | null; dateOfDeath: string | null } | null;
};
type AicsClient = {
  id: string; lastName: string; firstName: string; middleName: string | null; dateOfBirth: string | null;
  sex: string | null; civilStatus: string | null; barangay: string | null; occupation?: string | null;
  familyMembers?: FamilyMember[]; updatedAt?: string;
  isSenior?: boolean; isPwd?: boolean; isSoloParent?: boolean; is4ps?: boolean;
};
type FamilyMember = { name: string; dateOfBirth?: string | null; relationship: string | null; sex: string | null; occupation: string | null };

export type BridgeResult = {
  // Releases AICS sent, and what became of them.
  received: number;
  added: number;
  newCitizens: number;
  // Citizens already here whose empty details AICS filled in.
  citizensFilledIn: number;
  sentToReview: number;
  withdrawn: number;
  alreadyHere: number;
  // Could not be matched to anyone: the AICS client has no date of birth.
  skippedNoBirthdate: number;
  // Family members linked into their client's household; how many of those
  // to look at under possible duplicates (no date of birth, or a name close
  // to somebody else's); and those left out (already in another household,
  // or a name with no family name).
  householdMembersAdded: number;
  householdMembersToCheck: number;
  householdMembersSkipped: number;
  // Releases already here that AICS corrected since.
  updated: number;
  // Deaths recorded in Civil Registry from burial assistance.
  deathsRecorded: number;
  // Citizens put on a CSWD program list (senior citizen, PWD, solo parent, 4Ps) from their AICS marks.
  programRecordsAdded: number;
};
export type BridgeState = { since: string | null; clientsSince: string | null; lastRunAt: string | null; lastError: string | null; lastResult: BridgeResult | null };
export type BridgeStatus = BridgeState & { configured: boolean; running: boolean };

const EMPTY: BridgeState = { since: null, clientsSince: null, lastRunAt: null, lastError: null, lastResult: null };

export async function getBridgeState(): Promise<BridgeState> {
  const raw = await getSetting(STATE_KEY);
  try {
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<BridgeState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

let running = false;
export async function getBridgeStatus(): Promise<BridgeStatus> {
  return { ...(await getBridgeState()), configured: env.aicsBridge !== null, running };
}

async function call<T>(path: string): Promise<T> {
  const bridge = env.aicsBridge;
  if (!bridge) throw new Error('The AICS connection is not set up (AICS_BRIDGE_URL and AICS_BRIDGE_KEY)');
  const ask = () => fetch(`${bridge.url}${path}`, { headers: { 'X-Integration-Key': bridge.key }, signal: AbortSignal.timeout(30_000) });
  let res = await ask();
  // AICS allows each key so many calls a minute, then refuses for 30 seconds.
  const wait = Number(process.env.AICS_BRIDGE_RATE_LIMIT_WAIT_MS ?? 35_000);
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await ask();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`AICS answered ${res.status}${body?.message ? `: ${body.message}` : ''} for ${path.split('?')[0]}`);
  }
  return (await res.json()) as T;
}

// AICS types a barangay's name; the registry uses codes. "Brgy. I", "Barangay
// I (Poblacion)" and "barangay i" are the same place.
const barangayKey = (name: string) => name.toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(barangay|brgy)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');

const ASSISTANCE_WORD: Record<string, string> = { medicine: 'medicine', medical: 'medical', hospital: 'hospital', burial: 'burial', eyeglass: 'eyeglass', plain: 'financial' };
const sexCode = (sex: string | null) => (/^f/i.test(sex ?? '') ? 'F' : /^m/i.test(sex ?? '') ? 'M' : undefined);

// Fills what the registry does not have yet about a citizen from the AICS
// client. A detail that already has a value is left as it is.
async function fillBlanks(client: PrismaClient, personKey: string, details: Record<string, string | undefined>): Promise<boolean> {
  const fields = { personMname: details.mname, personSex: details.sex, personCivilStatus: details.civilStatus, personBrgyCode: details.brgyCode, personOccupation: details.occupation };
  const now = await client.citizen.findUnique({ where: { personKey }, select: { personMname: true, personSex: true, personCivilStatus: true, personBrgyCode: true, personOccupation: true } });
  if (!now) return false;
  const patch = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value && !now[key as keyof typeof now]?.trim()));
  if (Object.keys(patch).length === 0) return false;
  await client.citizen.update({ where: { personKey }, data: { ...patch, updatedBy: AICS_BRIDGE_ACTOR }, select: { personKey: true } });
  await insertAuditLog(client, { tableName: 'Citizen', recordId: personKey, action: 'update', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role, changedFields: { ...patch, reason: 'Filled from AICS' } });
  return true;
}

// A family member is typed as one name. Most carry the client's family name
// (or the client's middle name, on the mother's side), which says where the
// given name ends; otherwise the last word is taken as the family name.
const NAME_PARTICLES = new Set(['DE', 'DEL', 'DELA', 'DELOS', 'LA', 'LOS', 'SAN', 'STA', 'STA.', 'STO', 'STO.', 'VDA', 'VDA.']);
export function splitMemberName(raw: string, person: { lastName: string; middleName: string | null }): { lname: string; fname: string } | null {
  const words = (text: string) => text.toUpperCase().split(/\s+/).filter(Boolean);
  let given: string[];
  let family: string[];
  if (raw.includes(',')) {
    family = words(raw.slice(0, raw.indexOf(',')));
    given = words(raw.slice(raw.indexOf(',') + 1));
  } else {
    given = words(raw);
    const suffix = /^(JR|SR|II|III|IV)\.?$/.test(given[given.length - 1] ?? '') ? given.pop() : undefined;
    const known = [person.lastName, person.middleName ?? ''].map(words).find((name) => name.length > 0 && name.length < given.length && name.every((word, i) => word === given[given.length - name.length + i]));
    let size = known ? known.length : 1;
    if (!known) while (size < given.length - 1 && NAME_PARTICLES.has(given[given.length - size - 1] ?? '')) size++;
    family = given.splice(given.length - size, size);
    if (suffix) given.push(suffix);
  }
  // A middle initial is not part of the given name.
  if (given.length > 1 && /^[A-Z]\.?$/.test(given[given.length - 1] ?? '')) given.pop();
  return given.length > 0 && family.length > 0 ? { lname: family.join(' '), fname: given.join(' ') } : null;
}

// The CSWD program (module slug) each AICS mark stands for.
const PROGRAM_OF = { senior_citizen: 'isSenior', pwd: 'isPwd', solo_parent: 'isSoloParent', '4ps': 'is4ps' } as const;
const SENIOR_AGE = 60;
const ageOn = (born: string, day: Date) => day.getFullYear() - Number(born.slice(0, 4)) - (day.toISOString().slice(5, 10) < born.slice(5, 10) ? 1 : 0);

const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s-])[a-z]/g, (letter) => letter.toUpperCase());

// Makes the client's AICS family composition their household. Adds only:
// someone who heads or belongs to another household stays where they are.
async function syncHousehold(client: PrismaClient, headKey: string, person: AicsClient, brgyCode: string | undefined, result: BridgeResult): Promise<void> {
  const members = (person.familyMembers ?? []).filter((member) => member.name?.trim());
  if (members.length === 0) return;
  const head = await client.citizen.findUnique({ where: { personKey: headKey }, select: { personParentKey: true, isArchived: true } });
  if (!head || head.isArchived || head.personParentKey) return;

  const plain = (text: string) => text.toUpperCase().replace(/\s+/g, ' ').trim();
  const inHouse = await client.citizen.findMany({ where: { personParentKey: headKey, isArchived: false }, select: { personKey: true, personLname: true, personFname: true, personBdate: true } });

  for (const member of members) {
    const name = splitMemberName(member.name, person);
    if (!name) { result.householdMembersSkipped++; continue; }
    const born = member.dateOfBirth ? new Date(member.dateOfBirth) : null;
    const details = { sex: sexCode(member.sex), brgyCode, occupation: member.occupation?.trim().toUpperCase() || undefined };

    // Already in this household under this name: the same person, whose date of birth AICS may only now have.
    const here = inHouse.find((m) => plain(m.personLname) === name.lname && plain(m.personFname) === name.fname && (!born || !m.personBdate || m.personBdate.getTime() === born.getTime()));
    if (here) {
      if (born && !here.personBdate) {
        await client.citizen.update({ where: { personKey: here.personKey }, data: { personBdate: born, updatedBy: AICS_BRIDGE_ACTOR }, select: { personKey: true } });
        await insertAuditLog(client, { tableName: 'Citizen', recordId: here.personKey, action: 'update', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role, changedFields: { personBdate: member.dateOfBirth, reason: 'Filled from AICS' } });
        here.personBdate = born;
      }
      await fillBlanks(client, here.personKey, details);
      continue;
    }

    let personKey: string;
    let unsure = false;
    if (born) {
      const found = await resolvePerson({ ...name, bdate: born, sex: details.sex, brgyCode }, { actorUserId: AICS_BRIDGE_ACTOR, client, createIfUnsure: true });
      if (found.status === 'needs_review' || found.personKey === headKey) continue;
      personKey = found.personKey;
      unsure = found.status === 'created' && found.unsure === true;
      if (inHouse.some((m) => m.personKey === personKey)) { await fillBlanks(client, personKey, details); continue; }
      if (found.status === 'created') await insertAuditLog(client, { tableName: 'Citizen', recordId: personKey, action: 'insert', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role });
    } else {
      // No date of birth to match on: a new citizen of this household.
      const created = await client.citizen.create({ data: { personLname: name.lname, personFname: name.fname, personSex: details.sex ?? null, personBrgyCode: brgyCode ?? null, createdBy: AICS_BRIDGE_ACTOR, updatedBy: AICS_BRIDGE_ACTOR }, select: { personKey: true } });
      await insertAuditLog(client, { tableName: 'Citizen', recordId: created.personKey, action: 'insert', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role });
      personKey = created.personKey;
      unsure = true;
    }

    const headed = await designateHouseholdHead(client, headKey, AICS_BRIDGE_ACTOR, ACTOR.role);
    const linked = headed.ok ? await addHouseholdMember(client, headKey, personKey, member.relationship?.trim() ? titleCase(member.relationship.trim()) : 'Relative', AICS_BRIDGE_ACTOR, ACTOR.role) : headed;
    if (!linked.ok) { result.householdMembersSkipped++; continue; }
    result.householdMembersAdded++;
    if (unsure) result.householdMembersToCheck++;
    inHouse.push({ personKey, personLname: name.lname, personFname: name.fname, personBdate: born });
    await fillBlanks(client, personKey, details);
  }
}

// One run. Safe to call again at any time: a release already here is skipped.
export async function syncAics(client: PrismaClient): Promise<BridgeResult> {
  if (running) throw new Error('A sync with AICS is already running');
  running = true;
  const state = await getBridgeState();
  const result: BridgeResult = { received: 0, added: 0, newCitizens: 0, citizensFilledIn: 0, sentToReview: 0, withdrawn: 0, alreadyHere: 0, skippedNoBirthdate: 0, householdMembersAdded: 0, householdMembersToCheck: 0, householdMembersSkipped: 0, updated: 0, deathsRecorded: 0, programRecordsAdded: 0 };
  try {
    const module = await client.officeModule.findFirst({
      where: { slug: AICS_SLUG },
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, requiresCitizenLink: true, collectPersonInfo: true, assistanceAmountKey: true, formFields: { select: { key: true, fieldType: true, options: true } } },
    });
    if (!module || !module.collectPersonInfo) throw new Error('No program with the code "aics" that records people. Create it under CSWD first.');
    const field = (key: string) => module.formFields.find((f) => f.key === key);
    const barangays = new Map((await client.barangay.findMany({ select: { code: true, name: true } })).map((b) => [barangayKey(b.name), b.code]));

    // What is already here, as a record or waiting in Duplicate review.
    const have = new Map(
      (await client.$queryRaw<Array<{ case_id: string; record_key: string | null; archived: boolean; client_id: string | null; person_key: string | null }>>(Prisma.sql`
        SELECT data->>'_aics_case_id' AS case_id, record_key::text, is_archived AS archived, data->>'_aics_client_id' AS client_id, person_key::text
        FROM office_record WHERE module_id = ${module.id}::uuid AND data ? '_aics_case_id'
        UNION ALL
        SELECT candidate_data->'fields'->>'_aics_case_id', NULL, false, NULL, NULL
        FROM duplicate_review_queue_item WHERE module_id = ${module.id}::uuid AND status = 'pending' AND candidate_data->'fields' ? '_aics_case_id'`)
      ).map((r) => [r.case_id, r]),
    );
    // The CSWD programs an AICS mark puts a citizen on.
    const programs = await client.officeModule.findMany({ where: { slug: { in: Object.keys(PROGRAM_OF) }, collectPersonInfo: true }, orderBy: { createdAt: 'asc' }, select: { id: true, slug: true } });
    const enrol = async (personKey: string, person: AicsClient) => {
      const marked = programs.filter((program, i) => programs.findIndex((p) => p.slug === program.slug) === i && person[PROGRAM_OF[program.slug as keyof typeof PROGRAM_OF]] === true
        // A senior mark on someone the birthdate says is younger is a slip in AICS.
        && (program.slug !== 'senior_citizen' || (person.dateOfBirth !== null && ageOn(person.dateOfBirth, new Date()) >= SENIOR_AGE)));
      if (marked.length === 0) return;
      const has = await client.officeRecord.findMany({ where: { personKey, module: { slug: { in: [...marked.map((p) => p.slug), DEATH_SLUG] } } }, select: { isArchived: true, module: { select: { slug: true } } } });
      if (has.some((r) => r.module.slug === DEATH_SLUG && !r.isArchived)) return;
      for (const program of marked) {
        if (has.some((r) => r.module.slug === program.slug)) continue;
        const record = await createOfficeRecord(client, program.id, personKey, null, { _source: 'aics', _aics_client_id: person.id }, AICS_BRIDGE_ACTOR);
        await insertAuditLog(client, { tableName: record.table, recordId: record.recordId, action: 'insert', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role, changedFields: { reason: 'Marked in AICS', aicsClientId: person.id } });
        result.programRecordsAdded++;
      }
    };

    // What a release puts on its record: only the fields this program's form has; a dropdown keeps one of its own options.
    const amountKey = module.assistanceAmountKey ?? (field('amount_granted_php') ? 'amount_granted_php' : null);
    const recordData = (release: Release): Record<string, unknown> => {
      const word = ASSISTANCE_WORD[release.assistanceType] ?? release.assistanceType;
      const typeField = field('assistance_type');
      return {
        _aics_case_id: release.id,
        _aics_client_id: release.clientId,
        _source: 'aics',
        ...(typeField ? { assistance_type: typeField.options.find((o) => o.toLowerCase().startsWith(word)) ?? word.charAt(0).toUpperCase() + word.slice(1) } : {}),
        ...(amountKey && release.amount !== null ? { [amountKey]: release.amount } : {}),
        ...(field('date_released') ? { date_released: release.releasedAt.slice(0, 10) } : {}),
        ...(field('voucher_control_no') && release.caseNumber ? { voucher_control_no: release.caseNumber } : {}),
        ...(field('patient_deceased_name') && release.beneficiaryName ? { patient_deceased_name: release.beneficiaryName.toUpperCase() } : {}),
      };
    };

    // Deaths this bridge recorded from burial releases, by AICS case.
    const deathModule = await client.officeModule.findFirst({ where: { slug: DEATH_SLUG, collectPersonInfo: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    const deaths = new Map(
      deathModule
        ? (await client.$queryRaw<Array<{ case_id: string; record_key: string; linked: boolean; archived: boolean }>>(Prisma.sql`
            SELECT data->>'_aics_case_id' AS case_id, record_key::text, person_key IS NOT NULL AS linked, is_archived AS archived
            FROM office_record WHERE module_id = ${deathModule.id}::uuid AND data ? '_aics_case_id'`)).map((r) => [r.case_id, r] as const)
        : [],
    );
    const recordDeath = async (release: Release, requestor: AicsClient | undefined) => {
      if (!deathModule || release.assistanceType !== 'burial' || !release.deceased?.name || deaths.has(release.id)) return;
      const name = splitMemberName(release.deceased.name, requestor ?? { lastName: '', middleName: null });
      if (!name) return;
      const died = release.deceased.dateOfDeath;
      const already = died
        ? await client.$queryRaw<Array<{ record_key: string }>>(Prisma.sql`
            SELECT r.record_key::text FROM office_record r LEFT JOIN "Citizen" c ON c.person_key = r.person_key
            WHERE r.module_id = ${deathModule.id}::uuid AND NOT r.is_archived AND r.data->>'date_of_death' = ${died}
              AND name_key(coalesce(c.person_lname, r.unresolved_person->>'lname', '')) = name_key(${name.lname})
              AND name_key(coalesce(c.person_fname, r.unresolved_person->>'fname', '')) = name_key(${name.fname})
            LIMIT 1`)
        : [];
      if (already[0]) { deaths.set(release.id, { case_id: release.id, record_key: already[0].record_key, linked: true, archived: false }); return; }
      const record = await createOfficeRecord(client, deathModule.id, null, name, {
        _aics_case_id: release.id,
        _source: 'aics',
        ...(died ? { date_of_death: died } : {}),
      }, AICS_BRIDGE_ACTOR);
      await insertAuditLog(client, { tableName: record.table, recordId: record.recordId, action: 'insert', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role, changedFields: { reason: 'Burial assistance released in AICS', aicsCaseId: release.id } });
      deaths.set(release.id, { case_id: release.id, record_key: record.recordId, linked: false, archived: false });
      result.deathsRecorded++;
    };

    // The AICS clients who are citizens here, and those to bring up to date in this run.
    const known = new Map([...have.values()].flatMap((r) => (r.client_id && r.person_key && !r.archived ? [[r.client_id, r.person_key] as const] : [])));
    const touched = new Map<string, { personKey: string; isNew: boolean }>();
    const clients = new Map<string, AicsClient>();
    let latestClient = state.clientsSince;
    const seen = (person: AicsClient) => { if (person.updatedAt && (!latestClient || person.updatedAt > latestClient)) latestClient = person.updatedAt; };
    let cursor: string | null = null;
    // The first pull brings every release: fetch the clients by the page
    // instead of one call each, which AICS's per-minute limit would refuse.
    if (!state.since) {
      do {
        const query = new URLSearchParams({ limit: '500', ...(cursor ? { cursor } : {}) });
        const page: { items: AicsClient[]; nextCursor: string | null } = await call(`/clients?${query.toString()}`);
        for (const person of page.items) { clients.set(person.id, person); seen(person); }
        cursor = page.nextCursor;
      } while (cursor);
    } else {
      // Later pulls: the clients already here whose AICS profile changed.
      const from = state.clientsSince ?? state.since;
      do {
        const query = new URLSearchParams({ limit: '500', updatedSince: from, ...(cursor ? { cursor } : {}) });
        const page: { items: AicsClient[]; nextCursor: string | null } = await call(`/clients?${query.toString()}`);
        for (const person of page.items) {
          seen(person);
          const personKey = known.get(person.id);
          if (personKey) { clients.set(person.id, person); touched.set(person.id, { personKey, isNew: false }); }
        }
        cursor = page.nextCursor;
      } while (cursor);
    }

    let latest = state.since;
    do {
      const query = new URLSearchParams({ limit: '200', ...(state.since ? { updatedSince: state.since } : {}), ...(cursor ? { cursor } : {}) });
      const page: { items: Release[]; nextCursor: string | null } = await call(`/releases?${query.toString()}`);
      for (const release of page.items) {
        result.received++;
        if (!latest || release.updatedAt > latest) latest = release.updatedAt;
        const existing = have.get(release.id);

        if (release.withdrawn) {
          if (existing?.record_key && !existing.archived) {
            await client.officeRecord.update({ where: { id: existing.record_key }, data: { isArchived: true, updatedBy: AICS_BRIDGE_ACTOR }, select: { id: true } });
            await insertAuditLog(client, { tableName: 'office_record', recordId: existing.record_key, action: 'delete', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role, changedFields: { reason: 'Archived or cancelled in AICS', aicsCaseId: release.id } });
            result.withdrawn++;
          }
          // The death it recorded goes too, unless Civil Registry has already linked it to a citizen.
          const death = deaths.get(release.id);
          if (death && !death.linked && !death.archived) {
            await client.officeRecord.update({ where: { id: death.record_key }, data: { isArchived: true, updatedBy: AICS_BRIDGE_ACTOR }, select: { id: true } });
            await insertAuditLog(client, { tableName: 'office_record', recordId: death.record_key, action: 'delete', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role, changedFields: { reason: 'Archived or cancelled in AICS', aicsCaseId: release.id } });
            death.archived = true;
          }
          continue;
        }
        await recordDeath(release, clients.get(release.clientId));
        if (existing) {
          result.alreadyHere++;
          // Corrected in AICS since it was pulled (amount, type, date): correct the record here.
          // This also notes the AICS client on a record pulled before records carried it.
          if (existing.record_key && !existing.archived) {
            const stored = ((await client.officeRecord.findUnique({ where: { id: existing.record_key }, select: { data: true } }))?.data ?? {}) as Record<string, unknown>;
            const changed = Object.entries(recordData(release)).filter(([key, value]) => JSON.stringify(stored[key]) !== JSON.stringify(value));
            if (changed.length > 0) {
              await client.$executeRaw`UPDATE office_record SET data = data || ${JSON.stringify(Object.fromEntries(changed))}::jsonb, created_at = ${new Date(release.releasedAt)}, updated_by = ${AICS_BRIDGE_ACTOR}::uuid WHERE record_key = ${existing.record_key}::uuid`;
              if (changed.some(([key]) => key !== '_aics_client_id')) {
                await insertAuditLog(client, { tableName: 'office_record', recordId: existing.record_key, action: 'update', actorUserId: AICS_BRIDGE_ACTOR, actorRole: ACTOR.role, changedFields: { ...Object.fromEntries(changed), reason: 'Corrected in AICS' } });
                result.updated++;
              }
            }
            existing.client_id = release.clientId;
          }
          if (existing.person_key && clients.has(release.clientId) && !touched.has(release.clientId)) touched.set(release.clientId, { personKey: existing.person_key, isNew: false });
          continue;
        }

        let person = clients.get(release.clientId);
        if (!person) {
          person = await call<AicsClient>(`/clients/${release.clientId}`);
          clients.set(release.clientId, person);
        }
        if (!person.dateOfBirth) { result.skippedNoBirthdate++; continue; }

        const core = uppercaseStrings({
          lname: person.lastName,
          fname: person.firstName,
          mname: person.middleName ?? undefined,
          bdate: new Date(person.dateOfBirth),
          sex: sexCode(person.sex),
          civilStatus: person.civilStatus ?? undefined,
          brgyCode: person.barangay ? barangays.get(barangayKey(person.barangay)) : undefined,
        });
        const data = recordData(release);

        const outcome = await submitIntake(client, module, core, data, ACTOR);
        have.set(release.id, { case_id: release.id, record_key: 'recordId' in outcome ? outcome.recordId : null, archived: false, client_id: release.clientId, person_key: 'personKey' in outcome ? outcome.personKey : null });
        if (outcome.kind === 'needs_review') { result.sentToReview++; continue; }
        if (outcome.kind === 'linked') {
          result.added++;
          if (outcome.status === 'created') result.newCitizens++;
          if (!touched.has(release.clientId)) touched.set(release.clientId, { personKey: outcome.personKey, isNew: outcome.status === 'created' });
          // The Assistance page dates a release by when its record was made:
          // make that the day AICS released it, not the day it was pulled.
          await client.$executeRaw`UPDATE office_record SET created_at = ${new Date(release.releasedAt)} WHERE record_key = ${outcome.recordId}::uuid`;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);

    for (const [clientId, { personKey, isNew }] of touched) {
      const person = clients.get(clientId);
      if (!person) continue;
      const brgyCode = person.barangay ? barangays.get(barangayKey(person.barangay)) : undefined;
      const filled = await fillBlanks(client, personKey, {
        mname: person.middleName?.trim().toUpperCase() || undefined, sex: sexCode(person.sex), civilStatus: person.civilStatus?.trim().toUpperCase() || undefined,
        brgyCode, occupation: person.occupation?.trim().toUpperCase() || undefined,
      });
      if (filled && !isNew) result.citizensFilledIn++;
      await syncHousehold(client, personKey, person, brgyCode, result);
      await enrol(personKey, person);
    }

    await setSetting(STATE_KEY, JSON.stringify({ since: latest, clientsSince: latestClient, lastRunAt: new Date().toISOString(), lastError: null, lastResult: result } satisfies BridgeState));
    return result;
  } catch (err) {
    // Keep `since` where it was, so the next run picks up from the same point.
    await setSetting(STATE_KEY, JSON.stringify({ ...state, lastRunAt: new Date().toISOString(), lastError: err instanceof Error ? err.message : String(err) } satisfies BridgeState));
    throw err;
  } finally {
    running = false;
  }
}

// Pulls on a timer while the server runs (index.ts). A failed run is logged
// and tried again at the next tick.
export function startAicsSchedule(client: PrismaClient): void {
  if (!env.aicsBridge) return;
  const minutes = env.aicsBridge.intervalMinutes;
  const run = () => {
    syncAics(client).catch((err) => console.error(`AICS sync failed: ${err instanceof Error ? err.message : String(err)}`));
  };
  setTimeout(run, 10_000).unref();
  setInterval(run, minutes * 60_000).unref();
  console.log(`AICS connection on: pulling released assistance every ${minutes} minutes`);
}
