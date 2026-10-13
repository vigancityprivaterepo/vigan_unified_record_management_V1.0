import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { insertAuditLog } from '../lib/auditLog';

type Client = PrismaClient | Prisma.TransactionClient;

// A household's living conditions: the per-household items of the CBMS
// questionnaire, with the answer lists as the 2024 Vigan CBMS report groups
// them. The web app draws its form from this list (sent with the household),
// so a new question or answer is added here and nowhere else. Codes are what
// is stored; a CBMS export is mapped to these codes when it is loaded.
export const HOUSEHOLD_PROFILE_FIELDS = [
  {
    key: 'waterSource',
    label: 'Main source of water',
    options: [
      ['piped_dwelling', 'Piped into dwelling'],
      ['piped_yard', 'Piped into yard or plot'],
      ['public_tap', 'Public tap or standpipe'],
      ['protected_well', 'Protected well, tube well or borehole'],
      ['unprotected_well', 'Unprotected (open dug) well'],
      ['tanker_peddler', 'Tanker truck, peddler or neighbor'],
    ],
  },
  {
    key: 'drinkingWater',
    label: 'Main source of drinking water',
    options: [
      ['refilling_station', 'Water refilling station'],
      ['bottled_water', 'Bottled water'],
      ['piped_dwelling', 'Piped into dwelling'],
      ['piped_yard', 'Piped into yard or plot'],
      ['piped_neighbor', 'Piped to neighbor'],
      ['public_tap', 'Public tap or standpipe'],
      ['tube_well', 'Tube well or borehole'],
      ['protected_well', 'Protected well'],
      ['protected_spring', 'Protected spring'],
      ['unprotected_well', 'Unprotected well'],
      ['surface_water', 'Surface water (river, pond, canal)'],
      ['cart_small_tank', 'Cart with small tank'],
    ],
  },
  {
    key: 'toiletFacility',
    label: 'Toilet facility',
    options: [
      ['flush_septic', 'Flush or pour flush to septic tank'],
      ['flush_pit', 'Flush or pour flush to pit latrine'],
      ['flush_elsewhere', 'Flush or pour flush to open drain or elsewhere'],
      ['ventilated_pit', 'Ventilated improved pit latrine'],
      ['pit_with_slab', 'Pit latrine with slab'],
      ['pit_without_slab', 'Pit latrine without slab, or open pit'],
      ['bucket', 'Bucket or pail'],
      ['public_toilet', 'Public toilet'],
      ['none', 'None (open defecation)'],
    ],
  },
  {
    key: 'electricity',
    label: 'Electricity',
    options: [
      ['yes', 'Has electricity'],
      ['no', 'No electricity'],
    ],
  },
  {
    key: 'tenureStatus',
    label: 'House and lot',
    options: [
      ['own_house_lot', 'Owns the house and lot'],
      ['rent_house_lot', 'Rents the house or room, including the lot'],
      ['own_house_rent_lot', 'Owns the house, rents the lot'],
      ['own_house_free_lot_consent', "Owns the house, lot is rent-free with the owner's consent"],
      ['own_house_free_lot_no_consent', "Owns the house, lot is rent-free without the owner's consent"],
      ['free_house_lot_consent', "House and lot are rent-free with the owner's consent"],
      ['free_house_lot_no_consent', "House and lot are rent-free without the owner's consent"],
    ],
  },
  {
    key: 'housingType',
    label: 'Type of housing unit',
    options: [
      ['single_house', 'Single house'],
      ['duplex', 'Duplex'],
      ['apartment_row', 'Apartment, accessoria or row house'],
      ['multi_unit', 'Other building with three or more units'],
      ['commercial', 'Commercial, industrial or agricultural building'],
      ['institutional', 'Institutional living quarter'],
      ['condominium', 'Condominium or condotel'],
    ],
  },
  {
    key: 'roofMaterial',
    label: 'Roof',
    options: [
      ['metal_sheet', 'Metal roofing sheets'],
      ['concrete_tile', 'Concrete, clay or slate tile'],
      ['half_metal_concrete', 'Half galvanized iron, half concrete'],
      ['asbestos', 'Asbestos'],
      ['wood_bamboo', 'Wood or bamboo'],
      ['thatch', 'Sod or thatch (cogon, nipa)'],
      ['makeshift', 'Makeshift, salvaged or improvised'],
    ],
  },
  {
    key: 'wallMaterial',
    label: 'Outer walls',
    options: [
      ['concrete', 'Concrete, brick or stone'],
      ['half_concrete_wood', 'Half concrete, brick or stone and half wood'],
      ['metal_sheet', 'Metal sheet'],
      ['wood_bamboo', 'Wood or bamboo'],
      ['sawali_nipa', 'Sawali, cogon or nipa'],
      ['fiber_cement', 'Fiber cement board'],
      ['glass', 'Glass'],
      ['asbestos', 'Asbestos'],
      ['makeshift', 'Makeshift, salvaged or improvised'],
    ],
  },
  {
    key: 'internetAccess',
    label: 'Internet',
    options: [
      ['home', 'Internet at home'],
      ['elsewhere', 'Uses the internet elsewhere'],
      ['none', 'No internet access'],
    ],
  },
] as const;

export type HouseholdProfileKey = (typeof HOUSEHOLD_PROFILE_FIELDS)[number]['key'];
export type HouseholdProfileValues = Record<HouseholdProfileKey, string | null>;

const KEYS = HOUSEHOLD_PROFILE_FIELDS.map((f) => f.key);
const VALUE_SELECT = Object.fromEntries(KEYS.map((k) => [k, true])) as Record<HouseholdProfileKey, true>;
const PROFILE_SELECT = { ...VALUE_SELECT, source: true, asOf: true } as const;

// Every question is optional (null or left out = not answered); an answer
// must be one of that question's codes.
export const householdProfileSchema = z
  .object(
    Object.fromEntries(
      HOUSEHOLD_PROFILE_FIELDS.map((f) => [
        f.key,
        z
          .string()
          .refine((v) => f.options.some(([code]) => code === v), { message: `Not one of the answers for "${f.label}"` })
          .nullable()
          .optional(),
      ]),
    ) as Record<HouseholdProfileKey, z.ZodOptional<z.ZodNullable<z.ZodEffects<z.ZodString>>>>,
  )
  .strict();

export type HouseholdProfile = { values: HouseholdProfileValues; source: string; asOf: string };

function shape(row: (HouseholdProfileValues & { source: string; asOf: Date }) | null): HouseholdProfile | null {
  if (!row) return null;
  const { source, asOf, ...values } = row;
  return { values, source, asOf: asOf.toISOString().slice(0, 10) };
}

export async function getHouseholdProfile(client: Client, headPersonKey: string): Promise<HouseholdProfile | null> {
  return shape(await client.householdProfile.findUnique({ where: { headPersonKey }, select: PROFILE_SELECT }));
}

// Saves the answers typed in on the Households page. Questions left out keep
// what they had. The profile becomes an office record as of today, even if it
// first came from CBMS: someone has just confirmed it.
export async function saveHouseholdProfile(
  client: Client,
  headPersonKey: string,
  input: Partial<HouseholdProfileValues>,
  actorUserId: string,
  actorRole: string,
): Promise<HouseholdProfile> {
  const before = await client.householdProfile.findUnique({ where: { headPersonKey }, select: VALUE_SELECT });
  const values = Object.fromEntries(KEYS.filter((k) => input[k] !== undefined).map((k) => [k, input[k] ?? null])) as Partial<HouseholdProfileValues>;
  const stamp = { source: 'office', asOf: new Date(), updatedBy: actorUserId };
  const row = await client.householdProfile.upsert({
    where: { headPersonKey },
    create: { headPersonKey, ...values, ...stamp, createdBy: actorUserId },
    update: { ...values, ...stamp },
    select: { id: true, ...PROFILE_SELECT },
  });
  const { id, ...saved } = row;
  const changed = Object.fromEntries(
    KEYS.filter((k) => values[k] !== undefined && (before?.[k] ?? null) !== values[k]).map((k) => [k, { from: before?.[k] ?? null, to: values[k] }]),
  );
  await insertAuditLog(client, {
    tableName: 'household_profile',
    recordId: id,
    action: before ? 'update' : 'insert',
    actorUserId,
    actorRole,
    changedFields: { headPersonKey, ...changed },
  });
  return shape(saved)!;
}

// The household has a new head (the old one died, or was merged into another
// citizen record): its living conditions go with it. If the new head already
// has a profile of their own, that one is kept.
export async function moveHouseholdProfile(client: Client, fromHeadKey: string, toHeadKey: string, actorUserId: string): Promise<void> {
  const [from, to] = await Promise.all([
    client.householdProfile.findUnique({ where: { headPersonKey: fromHeadKey }, select: { id: true } }),
    client.householdProfile.findUnique({ where: { headPersonKey: toHeadKey }, select: { id: true } }),
  ]);
  if (!from || to) return;
  await client.householdProfile.update({ where: { id: from.id }, data: { headPersonKey: toHeadKey, updatedBy: actorUserId }, select: { id: true } });
}
