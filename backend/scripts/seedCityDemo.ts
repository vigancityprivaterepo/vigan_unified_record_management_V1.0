// City-wide demo data for presenting the system: a sample registry of
// households across all 39 barangays, sample records for every office's
// programs, four more offices, and charts that read across offices.
//
// Everything this script adds is sample data, not real citizens:
//   - every record carries `_sample: true`, so the app labels it "Sample";
//   - every row is created by DEMO_ACTOR, which is how --remove finds it.
// It never edits or deletes rows it did not create.
//
// Usage (DATABASE_URL must be the migration-owner connection, same as the
// other scripts/*.ts files):
//   npx tsx --env-file=.env scripts/seedCityDemo.ts            add the demo data (once)
//   npx tsx --env-file=.env scripts/seedCityDemo.ts --remove   take all of it out again
//   npx tsx --env-file=.env scripts/seedCityDemo.ts --reset    remove, then add
//   npx tsx --env-file=.env scripts/seedCityDemo.ts --outreach add only the sample outreach results
import { randomUUID } from 'node:crypto';
import { Prisma, type OfficeFieldType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { applyDeath, DEATH_SLUG } from '../src/services/deathEffects';
import { toGapRule, whereFor } from '../src/services/programGaps';

const DEMO_ACTOR = '5a3d1e00-c17d-4d00-8000-000000000001';

// --- Random helpers (seeded, so every run builds the same city) -------------

let seed = 20261012;
function rng(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const chance = (p: number) => rng() < p;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;
// weighted(['Rice', 34], ['Corn', 18], ...)
function weighted<T>(...pairs: Array<readonly [T, number]>): T {
  let r = rng() * pairs.reduce((a, p) => a + p[1], 0);
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return (pairs[pairs.length - 1] as readonly [T, number])[0];
}
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const digits = (n: number) => String(int(0, 10 ** n - 1)).padStart(n, '0');

const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY - int(0, 9) * 3_600_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
// A date in the last `maxDays`, more likely in months with a higher weight
// (index 0 = January), so monthly charts show the season they should.
function seasonal(byMonth: number[], maxDays = 365): Date {
  const top = Math.max(...byMonth);
  for (;;) {
    const d = ago(int(1, maxDays));
    if (rng() < (byMonth[d.getMonth()] as number) / top) return d;
  }
}
const FLAT = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const ageOn = (bdate: Date, on = NOW) => Math.floor((on.getTime() - bdate.getTime()) / (365.25 * DAY));

// --- Names --------------------------------------------------------------------

const SURNAMES = [
  'Abaya', 'Acosta', 'Agbayani', 'Agcaoili', 'Alcantara', 'Alconis', 'Ancheta', 'Andaya', 'Aquino', 'Arce', 'Baquiran', 'Bautista',
  'Bello', 'Benzon', 'Bueno', 'Cabanilla', 'Cabrera', 'Calibuso', 'Castillo', 'Collado', 'Corpuz', 'Cortez', 'Cruz', 'Dela Cruz',
  'Domingo', 'Duque', 'Espiritu', 'Fabro', 'Favis', 'Ferrer', 'Figueras', 'Flores', 'Formoso', 'Gaerlan', 'Galang', 'Garcia',
  'Gonzales', 'Guerrero', 'Hernando', 'Ibarra', 'Javier', 'Lazo', 'Leones', 'Lizardo', 'Llanes', 'Lopez', 'Mabanag', 'Madarang',
  'Manzano', 'Marcelo', 'Martinez', 'Medina', 'Mendoza', 'Molina', 'Navarro', 'Pacis', 'Padilla', 'Pagaduan', 'Palafox', 'Pascua',
  'Pascual', 'Peralta', 'Pimentel', 'Purisima', 'Quiaoit', 'Quitoriano', 'Rabanal', 'Ragasa', 'Ramos', 'Rapanut', 'Reyes', 'Rivera',
  'Rosario', 'Sabado', 'Salvador', 'Santos', 'Singson', 'Somera', 'Soriano', 'Tabios', 'Tadena', 'Tagorda', 'Tolentino', 'Torres',
  'Ugale', 'Valdez', 'Velasco', 'Verzosa', 'Villanueva', 'Viloria', 'Yadao', 'Zamora',
];
const FIRST_M = [
  'Alfredo', 'Andres', 'Angelo', 'Antonio', 'Arnel', 'Benjamin', 'Bernardo', 'Carlo', 'Cesar', 'Christian', 'Danilo', 'Dennis',
  'Edgar', 'Eduardo', 'Emmanuel', 'Ernesto', 'Federico', 'Fernando', 'Francis', 'Gerald', 'Gilbert', 'Gregorio', 'Jaime', 'Jayson',
  'Jerome', 'Joel', 'John Paul', 'Jose', 'Joseph', 'Juan', 'Julius', 'Kenneth', 'Leonardo', 'Lorenzo', 'Manuel', 'Marcelino',
  'Mario', 'Mark', 'Marlon', 'Melchor', 'Michael', 'Nestor', 'Noel', 'Orlando', 'Pedro', 'Ramon', 'Raymond', 'Reynaldo', 'Ricardo',
  'Roberto', 'Rodel', 'Rodrigo', 'Rogelio', 'Romeo', 'Ronald', 'Samuel', 'Teodoro', 'Victor', 'Wilfredo', 'Zaldy',
];
const FIRST_F = [
  'Aida', 'Analyn', 'Angelica', 'Aurora', 'Beatriz', 'Carmelita', 'Carmen', 'Cecilia', 'Charlene', 'Corazon', 'Cristina', 'Daisy',
  'Divina', 'Editha', 'Elena', 'Elizabeth', 'Erlinda', 'Estrella', 'Evelyn', 'Felicidad', 'Florencia', 'Gloria', 'Grace', 'Imelda',
  'Jennifer', 'Jocelyn', 'Josefina', 'Joy', 'Juliet', 'Kristine', 'Leonora', 'Lilia', 'Lorna', 'Lourdes', 'Luz', 'Marilou',
  'Marites', 'Mary Ann', 'Mary Grace', 'Melinda', 'Mercedes', 'Milagros', 'Myrna', 'Nenita', 'Norma', 'Ofelia', 'Perla', 'Remedios',
  'Rhea', 'Rosalinda', 'Rosario', 'Rowena', 'Shiela', 'Susana', 'Teresita', 'Trinidad', 'Veronica', 'Victoria', 'Virginia', 'Zenaida',
];
const STREETS = ['Purok 1', 'Purok 2', 'Purok 3', 'Purok 4', 'Purok 5', 'Purok 6', 'Sitio Centro', 'Sitio Nagtupacan', 'Sitio Lubong'];
const POB_STREETS = ['Quezon Ave.', 'Rizal St.', 'Bonifacio St.', 'Burgos St.', 'Mabini St.', 'Plaridel St.', 'Salcedo St.', 'Liberation Blvd.', 'Gov. A. Reyes St.', 'Florentino St.'];

// --- Barangay profiles ----------------------------------------------------------
// Rough groupings so the sample city has a shape: a dense poblacion, low-lying
// barangays that flood, farming barangays, and a few that programs reach less.

const FLOOD_PRONE = new Set(['Mindoro', 'San Pedro', 'Pantay Daya', 'Pantay Laud', 'Pantay Fatima', 'Raois', 'Tamag', 'Paoa', 'Purok-a-bassit', 'Purok-a-dackel']);
const COASTAL = new Set(['Mindoro', 'San Pedro', 'Pantay Daya', 'Pantay Laud', 'Raois']);
const LESS_REACHED = new Set(['Bongtolan', 'Cabalangegan', 'Nagsangalan', 'Salindeg', 'Rugsuanan', 'Capangpangan']);
const DENGUE_HOTSPOTS = new Set(['Barangay VII (Poblacion)', 'Tamag', 'Pantay Daya', 'Ayusan Norte', 'Cabaroan Daya']);

type Brgy = { code: string; name: string; kind: 'poblacion' | 'flood' | 'farm' };
type Person = {
  key: string; hh: string; brgy: Brgy; sex: 'M' | 'F'; bdate: Date; age: number; lname: string; fname: string; mname: string;
  isHead: boolean; relation: string; occupation: string | null; civil: string; hhSize: number;
};

// --- Offices and programs this script adds -------------------------------------

type FieldDef = readonly [key: string, label: string, type: OfficeFieldType, options?: readonly string[]];
type ModuleDef = { office: string; slug: string; name: string; person: boolean; fields: FieldDef[] };
type OfficeDef = { slug: string; name: string; shortName: string; icon: string; hue: number };

const NEW_OFFICES: OfficeDef[] = [
  { slug: 'poso', name: 'Public Order and Safety Office', shortName: 'POSO', icon: 'shield', hue: 255 },
  { slug: 'economic_enterprise', name: 'City Economic Enterprise Office', shortName: 'CEEO', icon: 'store', hue: 65 },
  { slug: 'public_assistance', name: 'Public Assistance and Complaints Center', shortName: 'PACC', icon: 'clipboard', hue: 195 },
  { slug: 'youth_development', name: 'Local Youth Development Office', shortName: 'LYDO', icon: 'school', hue: 300 },
];

const TODAS = ['Poblacion TODA', 'Tamag TODA', 'Mindoro TODA', 'Bulala TODA', 'Ayusan TODA', 'San Julian TODA', 'Pantay TODA', 'Public Market TODA'];
const TRAFFIC_SPOTS = ['Quezon Avenue', 'Calle Crisologo area', 'Liberation Boulevard', 'Rizal Street', 'Public Market', 'Bantay boundary', 'Mindoro road', 'National Highway (Tamag)'];
const MARKET_SECTIONS = ['Meat', 'Fish', 'Vegetables & Fruits', 'Dry Goods', 'Rice & Grains', 'Carinderia / Eatery', 'Longganisa & Bagnet', 'Abel & Souvenirs'];
const CDC = ['Poblacion Child Development Center', 'Tamag Child Development Center', 'Ayusan Child Development Center', 'Bulala Child Development Center', 'Mindoro Child Development Center', 'Pantay Child Development Center', 'San Julian Child Development Center', 'Cabaroan Child Development Center'];

function newModules(barangayNames: string[]): ModuleDef[] {
  return [
    { office: 'cswd', slug: 'day_care', name: 'Day Care Children', person: true, fields: [
      ['child_development_center', 'Child Development Center', 'SELECT', CDC],
      ['school_year', 'School Year', 'SELECT', ['2025-2026', '2026-2027']],
      ['guardian_name', 'Parent / Guardian', 'TEXT'],
      ['nutritional_status_at_entry', 'Nutritional Status at Entry', 'SELECT', ['Normal', 'Underweight', 'Overweight']],
      ['with_birth_certificate', 'With Birth Certificate', 'BOOLEAN'],
    ] },
    { office: 'city_health', slug: 'nutrition', name: 'Child Nutrition (Operation Timbang)', person: true, fields: [
      ['date_weighed', 'Date Weighed', 'DATE'],
      ['weight_kg', 'Weight (kg)', 'NUMBER'],
      ['height_cm', 'Height (cm)', 'NUMBER'],
      ['nutritional_status', 'Nutritional Status', 'SELECT', ['Normal', 'Underweight', 'Severely Underweight', 'Stunted', 'Wasted', 'Overweight']],
      ['feeding_program_enrolled', 'Enrolled in Feeding Program', 'BOOLEAN'],
    ] },
    { office: 'city_health', slug: 'disease_cases', name: 'Notifiable Disease Cases', person: true, fields: [
      ['date_reported', 'Date Reported', 'DATE'],
      ['disease', 'Disease', 'SELECT', ['Dengue', 'Influenza-like Illness', 'Tuberculosis', 'Hand, Foot and Mouth Disease', 'Leptospirosis', 'Typhoid Fever', 'Measles']],
      ['hospitalized', 'Hospitalized', 'BOOLEAN'],
      ['outcome', 'Outcome', 'SELECT', ['Recovered', 'Under Treatment', 'Admitted', 'Died']],
    ] },
    { office: 'city_agriculture_office', slug: 'fisherfolk', name: 'Fisherfolk', person: true, fields: [
      ['fishr_no', 'FishR No.', 'TEXT'],
      ['fishing_type', 'Type of Fishing Activity', 'SELECT', ['Municipal Capture Fishing', 'Aquaculture / Fishpond', 'Fish Vending', 'Gleaning', 'Fish Processing']],
      ['boat_type', 'Boat', 'SELECT', ['Motorized', 'Non-motorized', 'None']],
      ['boat_registered', 'Boat Registered (BoatR)', 'BOOLEAN'],
      ['years_fishing', 'Years Fishing', 'NUMBER'],
    ] },
    { office: 'city_agriculture_office', slug: 'farm_assistance', name: 'Farm Inputs Distributed', person: true, fields: [
      ['date_released', 'Date Released', 'DATE'],
      ['assistance', 'Assistance', 'SELECT', ['Certified Rice Seeds', 'Hybrid Corn Seeds', 'Fertilizer', 'Vegetable Seeds', 'Farm Tools', 'Fingerlings', 'Livestock Dispersal', 'Fuel Subsidy']],
      ['cropping_season', 'Cropping Season', 'SELECT', ['Wet Season', 'Dry Season']],
      ['quantity', 'Quantity', 'NUMBER'],
      ['unit', 'Unit', 'SELECT', ['Bags', 'Kilos', 'Packs', 'Pieces', 'Heads', 'Liters']],
      ['estimated_value_php', 'Estimated Value (PHP)', 'NUMBER'],
    ] },
    { office: 'civil_registry', slug: 'marriage', name: 'Marriage', person: true, fields: [
      ['registry_no', 'Registry No.', 'TEXT'],
      ['date_of_marriage', 'Date of Marriage', 'DATE'],
      ['spouse_name', 'Name of Spouse', 'TEXT'],
      ['place_of_marriage', 'Place of Marriage', 'TEXT'],
      ['type_of_ceremony', 'Type of Ceremony', 'SELECT', ['Civil', 'Church', 'Other Religious Rites']],
      ['date_registered', 'Date Registered', 'DATE'],
    ] },
    { office: 'enro', slug: 'waste_collection', name: 'Waste Collection', person: false, fields: [
      ['collection_date', 'Collection Date', 'DATE'],
      ['barangay', 'Barangay', 'SELECT', barangayNames],
      ['waste_type', 'Waste Type', 'SELECT', ['Biodegradable', 'Recyclable', 'Residual']],
      ['weight_kg', 'Weight (kg)', 'NUMBER'],
    ] },
    { office: 'poso', slug: 'traffic_violations', name: 'Traffic Violations', person: false, fields: [
      ['ticket_no', 'Ticket No.', 'TEXT'],
      ['date_of_violation', 'Date of Violation', 'DATE'],
      ['violation', 'Violation', 'SELECT', ['No Helmet', 'Illegal Parking', 'No Driver\'s License', 'Unregistered Vehicle', 'Overloading', 'Obstruction', 'Disregarding Traffic Sign', 'Reckless Driving', 'Colorum Operation']],
      ['vehicle_type', 'Vehicle', 'SELECT', ['Motorcycle', 'Tricycle', 'Private Car', 'Van / SUV', 'Truck', 'Jeepney / Bus', 'Kalesa']],
      ['location', 'Location', 'SELECT', TRAFFIC_SPOTS],
      ['fine_php', 'Fine (PHP)', 'NUMBER'],
      ['status', 'Status', 'SELECT', ['Paid', 'Unpaid', 'Contested']],
    ] },
    { office: 'poso', slug: 'tricycle_franchise', name: 'Tricycle Franchises (MTOP)', person: true, fields: [
      ['franchise_no', 'Franchise No.', 'TEXT'],
      ['body_no', 'Body No.', 'TEXT'],
      ['toda', 'TODA', 'SELECT', TODAS],
      ['date_issued', 'Date Issued', 'DATE'],
      ['valid_until', 'Valid Until', 'DATE'],
      ['franchise_status', 'Status', 'SELECT', ['Active', 'For Renewal', 'Expired']],
    ] },
    { office: 'economic_enterprise', slug: 'market_stalls', name: 'Public Market Stalls', person: true, fields: [
      ['stall_no', 'Stall No.', 'TEXT'],
      ['section', 'Section', 'SELECT', MARKET_SECTIONS],
      ['monthly_rental_php', 'Monthly Rental (PHP)', 'NUMBER'],
      ['contract_start', 'Contract Start', 'DATE'],
      ['contract_end', 'Contract End', 'DATE'],
      ['arrears_php', 'Unpaid Rental (PHP)', 'NUMBER'],
      ['payment_standing', 'Payment Standing', 'SELECT', ['Up to date', '1 to 2 months behind', '3 or more months behind']],
    ] },
    { office: 'economic_enterprise', slug: 'market_collections', name: 'Market and Slaughterhouse Collections', person: false, fields: [
      ['payment_date', 'Collection Date', 'DATE'],
      ['collection_type', 'Collection', 'SELECT', ['Stall Rental', 'Daily Cash Ticket', 'Slaughterhouse Fee', 'Parking Fee', 'Public Toilet']],
      ['official_receipt_no', 'Official Receipt No.', 'TEXT'],
      // Same key as the Treasurer's payment programs, so one chart can total all three.
      ['amount_paid_php', 'Amount Collected (PHP)', 'NUMBER'],
    ] },
    { office: 'public_assistance', slug: 'citizen_requests', name: 'Requests and Complaints', person: true, fields: [
      ['date_received', 'Date Received', 'DATE'],
      ['channel', 'Received Through', 'SELECT', ['Walk-in', 'Phone / Hotline', 'Facebook Page', 'Barangay Referral', '8888 Referral']],
      ['category', 'Concern', 'SELECT', ['Road / Drainage', 'Street Light', 'Garbage Collection', 'Noise / Public Disturbance', 'Stray Animals', 'Water Supply', 'Financial Assistance', 'Permit / Document Follow-up', 'Flooding', 'Others']],
      ['concern_barangay', 'Barangay Concerned', 'SELECT', barangayNames],
      ['referred_office', 'Referred To', 'SELECT', ['City Engineering', 'CENRO', 'CSWD', 'POSO', 'City Veterinary', 'BPLO', 'CDRRMO', 'City Health', 'Mayor\'s Office']],
      ['request_status', 'Status', 'SELECT', ['Resolved', 'In Progress', 'Pending']],
      ['days_to_resolve', 'Days to Resolve', 'NUMBER'],
      ['satisfaction', 'Client Satisfaction', 'SELECT', ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied']],
    ] },
    { office: 'youth_development', slug: 'youth_profile', name: 'Youth Profile (Katipunan ng Kabataan)', person: true, fields: [
      ['date_profiled', 'Date Profiled', 'DATE'],
      ['youth_classification', 'Youth Classification', 'SELECT', ['In-school Youth', 'Out-of-school Youth', 'Working Youth', 'Youth with Specific Needs']],
      ['educational_attainment', 'Educational Attainment', 'SELECT', ['Elementary', 'High School Level', 'High School Graduate', 'Vocational / TESDA', 'College Level', 'College Graduate']],
      ['registered_sk_voter', 'Registered SK Voter', 'BOOLEAN'],
      ['interested_in', 'Most Interested In', 'SELECT', ['Sports', 'Arts & Culture', 'Livelihood Training', 'Volunteer Work', 'Scholarship']],
    ] },
  ];
}

// --- Remove ----------------------------------------------------------------------

async function removeDemo(): Promise<void> {
  const demoPeople = Prisma.sql`SELECT person_key FROM "Citizen" WHERE created_by = ${DEMO_ACTOR}::uuid`;
  const widgets = await prisma.dashboardWidget.deleteMany({ where: { createdBy: DEMO_ACTOR } });
  const rules = await prisma.programGapRule.deleteMany({ where: { createdBy: DEMO_ACTOR } });
  // Also records someone added by hand to a sample citizen, or the citizen can't go.
  await prisma.$executeRaw`DELETE FROM outreach_contact WHERE created_by = ${DEMO_ACTOR}::uuid`;
  const records = await prisma.$executeRaw`
    DELETE FROM office_record WHERE created_by = ${DEMO_ACTOR}::uuid OR person_key IN (${demoPeople})`;
  await prisma.$executeRaw`UPDATE "Citizen" SET person_parent_key = NULL, person_sub_parent_key = NULL WHERE created_by = ${DEMO_ACTOR}::uuid`;
  const citizens = await prisma.$executeRaw`DELETE FROM "Citizen" WHERE created_by = ${DEMO_ACTOR}::uuid`;

  // Programs and offices this script added go too, unless someone has since
  // put their own records (or staff) in them.
  let modulesRemoved = 0;
  for (const def of newModules([])) {
    const mod = await prisma.officeModule.findFirst({ where: { slug: def.slug, office: { slug: def.office } } });
    if (!mod) continue;
    if ((await prisma.officeRecord.count({ where: { moduleId: mod.id } })) > 0) continue;
    await prisma.dashboardWidgetSource.deleteMany({ where: { moduleId: mod.id } });
    await prisma.programGapRule.deleteMany({ where: { targetModuleId: mod.id } });
    await prisma.duplicateReviewQueueItem.deleteMany({ where: { moduleId: mod.id } });
    await prisma.officeFormField.deleteMany({ where: { moduleId: mod.id } });
    await prisma.officeModule.delete({ where: { id: mod.id } });
    modulesRemoved++;
  }
  let officesRemoved = 0;
  for (const office of await prisma.office.findMany({ where: { createdBy: DEMO_ACTOR }, include: { _count: { select: { modules: true, staffAccounts: true } } } })) {
    if (office._count.modules > 0 || office._count.staffAccounts > 0) continue;
    await prisma.office.delete({ where: { id: office.id } });
    officesRemoved++;
  }
  console.log(`Removed ${citizens} sample citizens, ${records} records, ${widgets.count} charts, ${rules.count} program gap rules, ${modulesRemoved} programs, ${officesRemoved} offices.`);
}

// --- Sample outreach ---------------------------------------------------------------
// Results for about a third of the sample people on each "not yet served"
// list, as if staff had started working through them. More in barangays
// whose names sort first, so the per-barangay progress is uneven like real work.

async function addOutreach(): Promise<void> {
  const rules = await prisma.programGapRule.findMany({ where: { kind: 'missing', isActive: true } });
  let added = 0;
  for (const row of rules) {
    const rule = toGapRule(row);
    added += await prisma.$executeRaw(Prisma.sql`
      INSERT INTO outreach_contact (rule_id, person_key, status, note, contacted_on, created_by, updated_by)
      SELECT ${rule.id}::uuid, c.person_key,
        (ARRAY['reached','reached','reached','reached','declined','not_found','not_found','moved'])[1 + floor(random() * 8)::int],
        NULL, CURRENT_DATE - floor(random() * 30)::int, ${DEMO_ACTOR}::uuid, ${DEMO_ACTOR}::uuid
      FROM "Citizen" c
      WHERE c.created_by = ${DEMO_ACTOR}::uuid AND ${whereFor(rule, {})}
        AND random() < CASE WHEN c.person_brgy_code < 'VIG-014' THEN 0.6 ELSE 0.2 END
      ON CONFLICT (rule_id, person_key) DO NOTHING`);
  }
  console.log(`  ${added} sample outreach results on ${rules.length} "not yet served" lists`);
}

// The sample deaths are written straight to the table, so run what the Death
// form does on its own (services/deathEffects.ts): the person leaves their
// household and comes off the lists that have a cleanup rule.
async function applyDeaths(): Promise<void> {
  const admin = await prisma.staffAccount.findFirst({ where: { role: 'admin', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!admin) { console.log('  (no admin account yet, so sample deaths were not applied to households)'); return; }
  const deaths = await prisma.officeRecord.findMany({ where: { createdBy: DEMO_ACTOR, isArchived: false, personKey: { not: null }, module: { slug: DEATH_SLUG } }, select: { id: true } });
  let households = 0;
  for (const d of deaths) if ((await applyDeath(prisma, d.id, { userId: admin.id, role: 'admin' }))?.household) households++;
  console.log(`  ${deaths.length} sample deaths applied: ${households} left a household`);
}

// --- Add ---------------------------------------------------------------------------

async function addDemo(): Promise<void> {
  const barangays: Brgy[] = (await prisma.barangay.findMany({ where: { code: { startsWith: 'VIG-' } }, orderBy: { code: 'asc' } })).map((b) => ({
    code: b.code, name: b.name,
    kind: b.name.startsWith('Barangay ') ? 'poblacion' : FLOOD_PRONE.has(b.name) ? 'flood' : 'farm',
  }));
  if (barangays.length === 0) throw new Error('No VIG-* barangays found. Run the base seed (prisma/seed.ts) first.');
  const barangayNames = barangays.map((b) => b.name).sort();

  // Offices and programs
  for (const o of NEW_OFFICES) {
    if (await prisma.office.findUnique({ where: { slug: o.slug } })) continue;
    await prisma.office.create({ data: { name: o.name, slug: o.slug, shortName: o.shortName, icon: o.icon, accentHue: o.hue, createdBy: DEMO_ACTOR } });
  }
  for (const def of newModules(barangayNames)) {
    const office = await prisma.office.findUnique({ where: { slug: def.office } });
    if (!office) { console.warn(`  (skipped program "${def.name}": no office "${def.office}")`); continue; }
    if (await prisma.officeModule.findUnique({ where: { officeId_slug: { officeId: office.id, slug: def.slug } } })) continue;
    const sort = await prisma.officeModule.aggregate({ where: { officeId: office.id }, _max: { sortOrder: true } });
    await prisma.officeModule.create({
      data: {
        officeId: office.id, name: def.name, slug: def.slug, sortOrder: (sort._max.sortOrder ?? -1) + 1,
        collectPersonInfo: def.person, requiresCitizenLink: def.person,
        formFields: { create: def.fields.map(([key, label, fieldType, options], i) => ({ key, label, fieldType, options: [...(options ?? [])], sortOrder: i })) },
      },
    });
  }
  const moduleId = new Map<string, string>();
  for (const m of await prisma.officeModule.findMany({ select: { id: true, slug: true } })) if (!moduleId.has(m.slug)) moduleId.set(m.slug, m.id);

  // --- Sample registry: households across every barangay ---
  const people: Person[] = [];
  const rows: Prisma.CitizenCreateManyInput[] = [];
  const taken = new Set<string>();

  function occupationFor(age: number, sex: 'M' | 'F', b: Brgy): string | null {
    if (age < 5) return null;
    if (age < 18) return 'Student';
    if (age < 23 && chance(0.6)) return 'Student';
    if (age >= 65) return weighted(['Retired', 45], ['None', 25], ['Farmer', b.kind === 'poblacion' ? 2 : 22], ['Vendor', 8]);
    const common: Array<readonly [string, number]> = [
      ['Vendor', 9], ['Laborer', 8], ['Construction Worker', sex === 'M' ? 8 : 0], ['Tricycle Driver', sex === 'M' ? 16 : 0], ['Housekeeper', sex === 'F' ? 16 : 1],
      ['Teacher', 4], ['Government Employee', 6], ['Sales Clerk', 7], ['OFW', 4], ['None', 10], ['Store Owner', 5],
    ];
    if (b.kind === 'poblacion') return weighted(...common, ['Hotel / Restaurant Staff', 9], ['Tour Guide', 2], ['Kalesa Driver', sex === 'M' ? 3 : 0], ['Office Clerk', 8], ['Abel Weaver', sex === 'F' ? 3 : 0]);
    if (COASTAL.has(b.name)) return weighted(...common, ['Fisherman', sex === 'M' ? 26 : 3], ['Fish Vendor', sex === 'F' ? 12 : 2], ['Farmer', 12]);
    return weighted(...common, ['Farmer', sex === 'M' ? 40 : 14], ['Burnay Potter', 2], ['Abel Weaver', sex === 'F' ? 5 : 0]);
  }
  function educationFor(age: number): string | null {
    if (age < 5) return null;
    if (age < 12) return 'Elementary Level';
    if (age < 17) return 'High School Level';
    return weighted(['Elementary Graduate', age > 55 ? 30 : 8], ['High School Graduate', 38], ['College Level', 16], ['College Graduate', 24], ['Vocational', 10]);
  }
  function registeredOn(age: number): Date {
    const earliest = Math.min(900, Math.max(5, Math.floor(age * 365.25) + int(3, 25)));
    return ago(Math.min(earliest, chance(0.55) ? int(366, 900) : int(1, 365)));
  }

  function addPerson(p: {
    hh: string; brgy: Brgy; street: string; sex: 'M' | 'F'; age: number; lname: string; mname: string; isHead: boolean; relation: string;
    civil: string; parentKey: string | null; subParentKey?: string | null;
  }): Person {
    let fname = '';
    let bdate = NOW;
    do {
      fname = pick(p.sex === 'M' ? FIRST_M : FIRST_F);
      bdate = new Date(NOW.getTime() - (p.age * 365.25 + int(1, 360)) * DAY);
    } while (taken.has(`${p.lname}|${fname}|${iso(bdate)}`));
    taken.add(`${p.lname}|${fname}|${iso(bdate)}`);
    const age = ageOn(bdate);
    const key = p.isHead ? p.hh : randomUUID();
    const occupation = occupationFor(age, p.sex, p.brgy);
    const created = registeredOn(age);
    rows.push({
      personKey: key, personParentKey: p.parentKey, personSubParentKey: p.subParentKey ?? null, personIsHead: p.isHead, personRelationToHead: p.relation,
      personLname: p.lname.toUpperCase(), personFname: fname.toUpperCase(), personMname: p.mname.toUpperCase(),
      personStreet: p.street.toUpperCase(), personBrgyCode: p.brgy.code, personSex: p.sex, personGender: p.sex === 'M' ? 'Male' : 'Female',
      personBdate: new Date(iso(bdate)), personCivilStatus: p.civil, personReligion: weighted(['Roman Catholic', 82], ['Iglesia ni Cristo', 6], ['Aglipayan', 5], ['Born Again Christian', 5], ['Other', 2]),
      personEducLevel: educationFor(age), personOccupation: occupation,
      createdAt: created, updatedAt: created, createdBy: DEMO_ACTOR, updatedBy: DEMO_ACTOR,
    });
    const person: Person = { key, hh: p.hh, brgy: p.brgy, sex: p.sex, bdate, age, lname: p.lname, fname, mname: p.mname, isHead: p.isHead, relation: p.relation, occupation, civil: p.civil, hhSize: 1 };
    people.push(person);
    return person;
  }

  const soloParents: Person[] = [];
  // Not every household is reached by city programs. Some appear in no
  // program at all and some in only one to three, more so in the barangays
  // programs reach less, so "who gets no help" has a real answer.
  const programLimit = new Map<string, { max: number; slugs: Set<string> }>();
  for (const b of barangays) {
    const households = b.kind === 'poblacion' ? int(22, 32) : b.kind === 'flood' ? int(18, 27) : int(13, 23);
    for (let h = 0; h < households; h++) {
      const hh = randomUUID();
      const tier = weighted(['none', LESS_REACHED.has(b.name) ? 34 : 13], ['few', 30], ['any', LESS_REACHED.has(b.name) ? 36 : 57]);
      if (tier !== 'any') programLimit.set(hh, { max: tier === 'none' ? 0 : int(1, 3), slugs: new Set() });
      const lname = pick(SURNAMES);
      const street = pick(b.kind === 'poblacion' ? POB_STREETS : STREETS);
      const headAge = weighted([int(24, 34), 18], [int(35, 49), 34], [int(50, 64), 30], [int(65, 84), 18]);
      const headSex = chance(0.78) ? 'M' as const : 'F' as const;
      const hasSpouse = chance(headAge < 70 ? 0.72 : 0.45);
      const members: Person[] = [];
      const head = addPerson({
        hh, brgy: b, street, sex: headSex, age: headAge, lname, mname: pick(SURNAMES), isHead: true, relation: 'Head', parentKey: null,
        civil: hasSpouse ? 'Married' : headAge > 58 ? weighted(['Widowed', 70], ['Single', 15], ['Separated', 15]) : weighted(['Single', 40], ['Separated', 35], ['Widowed', 25]),
      });
      members.push(head);
      const motherMaiden = pick(SURNAMES);
      let motherAge = headSex === 'F' ? headAge : headAge - int(0, 5);
      if (hasSpouse) {
        const spouseAge = Math.max(19, headAge + (headSex === 'M' ? -int(0, 6) : int(0, 6)));
        if (headSex === 'M') motherAge = spouseAge;
        members.push(addPerson({ hh, brgy: b, street, sex: headSex === 'M' ? 'F' : 'M', age: spouseAge, lname, mname: headSex === 'M' ? motherMaiden : pick(SURNAMES), isHead: false, relation: 'Spouse', civil: 'Married', parentKey: hh }));
      }
      const childMiddle = headSex === 'M' ? motherMaiden : head.mname;
      const maxChildAge = motherAge - 19;
      const kids = maxChildAge < 0 ? 0 : weighted([0, 12], [1, 22], [2, 30], [3, 22], [4, 10], [5, 4]);
      const adultKids: Person[] = [];
      let minors = 0;
      for (let k = 0; k < kids; k++) {
        const age = int(Math.max(0, maxChildAge - 26), Math.min(maxChildAge, 38));
        if (age >= 24 && chance(0.6)) continue; // grown and moved out
        const sex = chance(0.51) ? 'M' as const : 'F' as const;
        const kid = addPerson({ hh, brgy: b, street, sex, age, lname, mname: childMiddle, isHead: false, relation: sex === 'M' ? 'Son' : 'Daughter', civil: 'Single', parentKey: hh });
        members.push(kid);
        if (age >= 20) adultKids.push(kid);
        if (age < 18) minors++;
      }
      const parentOfGrandkids = adultKids[0];
      if (parentOfGrandkids && chance(0.45)) {
        for (let g = 0; g < int(1, 2); g++) {
          const age = int(0, Math.min(9, parentOfGrandkids.age - 19));
          members.push(addPerson({ hh, brgy: b, street, sex: chance(0.5) ? 'M' : 'F', age, lname, mname: pick(SURNAMES), isHead: false, relation: 'Grandchild', civil: 'Single', parentKey: hh, subParentKey: parentOfGrandkids.key }));
          minors++;
        }
      }
      if (headAge < 58 && chance(0.1)) {
        const sex = chance(0.6) ? 'F' as const : 'M' as const;
        members.push(addPerson({ hh, brgy: b, street, sex, age: Math.min(92, headAge + int(22, 30)), lname: sex === 'M' ? lname : pick(SURNAMES), mname: pick(SURNAMES), isHead: false, relation: 'Parent', civil: 'Widowed', parentKey: hh }));
      }
      for (const m of members) m.hhSize = members.length;
      if (!hasSpouse && minors > 0 && head.age < 60) soloParents.push(head);
    }
  }

  const isHeadRow = (r: Prisma.CitizenCreateManyInput) => r.personIsHead === true;
  for (const batch of [rows.filter(isHeadRow), rows.filter((r) => !isHeadRow(r) && !r.personSubParentKey), rows.filter((r) => !!r.personSubParentKey)]) {
    for (let i = 0; i < batch.length; i += 500) await prisma.citizen.createMany({ data: batch.slice(i, i + 500) });
  }
  console.log(`  ${people.length} sample citizens in ${people.filter((p) => p.isHead).length} households, ${barangays.length} barangays`);

  // --- Records ---
  type Row = Prisma.OfficeRecordCreateManyInput;
  const records: Row[] = [];
  const counts = new Map<string, number>();
  const has = (slug: string) => moduleId.has(slug);
  function rec(slug: string, person: Person | null, data: Record<string, unknown>, at: Date): void {
    const id = moduleId.get(slug);
    if (!id) return;
    const limit = person ? programLimit.get(person.hh) : undefined;
    if (limit && !limit.slugs.has(slug)) {
      if (limit.slugs.size >= limit.max) return;
      limit.slugs.add(slug);
    }
    const when = at.getTime() > NOW.getTime() ? NOW : at;
    records.push({ moduleId: id, personKey: person?.key ?? null, data: { ...data, _sample: true } as Prisma.InputJsonValue, createdAt: when, updatedAt: when, createdBy: DEMO_ACTOR, updatedBy: DEMO_ACTOR });
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const full = (p: Person) => `${p.fname} ${p.mname.charAt(0)}. ${p.lname}`.toUpperCase();
  const phone = () => `09${digits(9)}`;
  const year = NOW.getFullYear();
  const some = (pool: Person[], n: number) => {
    const copy = [...pool];
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [copy[i], copy[j]] = [copy[j] as Person, copy[i] as Person]; }
    return copy.slice(0, Math.min(n, copy.length));
  };

  // Deaths first: the deceased are kept off every program, except a few left
  // on lists on purpose so "lists that need cleanup" has something to show.
  const deceased = new Set<string>();
  const stillListed = new Set<string>();
  const elderly = people.filter((p) => p.age >= 68 && !p.isHead);
  for (const p of [...some(elderly, 34), ...some(people.filter((x) => x.age >= 35 && x.age < 68 && !x.isHead), 8)]) {
    deceased.add(p.key);
    const died = seasonal(FLAT, 330);
    rec('death', p, {
      registry_no: `${died.getFullYear()}-D-${digits(4)}`, date_of_death: iso(died),
      place_of_death: weighted(['GABRIELA SILANG GENERAL HOSPITAL', 40], ['RESIDENCE', 42], ['METRO VIGAN HOSPITAL', 14], ['ILOCOS SUR DISTRICT HOSPITAL', 4]),
      cause_of_death: weighted(['CARDIOVASCULAR DISEASE', 30], ['PNEUMONIA', 16], ['CANCER', 14], ['STROKE', 13], ['DIABETES COMPLICATIONS', 9], ['KIDNEY DISEASE', 7], ['NATURAL CAUSES (OLD AGE)', 7], ['ROAD CRASH', 4]),
      date_registered: iso(addDays(died, int(1, 20))),
    }, addDays(died, int(1, 20)));
  }
  for (const p of some(people.filter((x) => deceased.has(x.key) && x.age >= 60), 6)) stillListed.add(p.key);
  const alive = people.filter((p) => !deceased.has(p.key));
  const adults = alive.filter((p) => p.age >= 18 && p.age < 60);
  const seniors = people.filter((p) => p.age >= 60 && (!deceased.has(p.key) || stillListed.has(p.key)));
  const under5 = alive.filter((p) => p.age < 5);
  const youth = alive.filter((p) => p.age >= 15 && p.age <= 30);
  const reach = (p: Person, normal: number, less: number) => chance(LESS_REACHED.has(p.brgy.name) ? less : normal);

  // CSWD
  const seniorListed: Person[] = [];
  for (const p of seniors) {
    if (!stillListed.has(p.key) && !reach(p, 0.88, 0.52)) continue;
    seniorListed.push(p);
    const issued = ago(int(40, 2400));
    rec('senior_citizen', p, {
      osca_id_no: `OSCA-${issued.getFullYear()}-${digits(5)}`, osca_id_date_issued: iso(issued), social_pension_beneficiary: chance(0.38),
      pension_source: weighted(['None', 55], ['SSS', 28], ['GSIS', 10], ['Veterans (PVAO)', 3], ['Private', 4]),
      living_arrangement: p.hhSize === 1 ? 'Living Alone' : weighted(['With Spouse', 30], ['With Family', 66], ['Living Alone', 3], ['In an Institution', 1]),
      contact_number: phone(),
    }, issued.getTime() < ago(540).getTime() ? ago(int(200, 540)) : issued);
  }
  const pwds = alive.filter((p) => chance(p.age >= 60 ? 0.07 : 0.018));
  for (const p of pwds) {
    rec('pwd', p, {
      pwd_id_no: `01-2934-000-${digits(7)}`,
      type_of_disability: weighted(['Physical Disability (Orthopedic)', 30], ['Visual Disability', 16], ['Deaf or Hard of Hearing', 13], ['Psychosocial Disability', 10], ['Intellectual Disability', 9], ['Speech and Language Impairment', 7], ['Mental Disability', 5], ['Learning Disability', 4], ['Cancer (RA 11215)', 4], ['Rare Disease (RA 10747)', 2]),
      cause_of_disability: p.age < 18 ? 'Congenital / Inborn' : weighted(['Acquired', 68], ['Congenital / Inborn', 32]),
      id_valid_until: iso(addDays(NOW, int(-150, 1300))), contact_number: phone(),
    }, ago(int(5, 520)));
  }
  const soloListed = soloParents.filter((p) => !deceased.has(p.key) && reach(p, 0.74, 0.4));
  for (const p of soloListed) {
    rec('solo_parent', p, {
      solo_parent_id_no: `SP-${year}-${digits(4)}`,
      solo_parent_category: p.civil === 'Widowed' ? 'Death of Spouse' : p.civil === 'Single' ? 'Unmarried Parent' : weighted(['Abandonment', 40], ['Legal Separation / Annulment / Nullity', 25], ['Spouse is an OFW (Low / Semi-skilled)', 20], ['Spouse Detained / Serving Sentence', 8], ['Spouse Physically or Mentally Incapacitated', 7]),
      number_of_children: int(1, Math.max(1, p.hhSize - 1)), monthly_income_php: roundTo(int(4000, 18000), 500), id_valid_until: iso(addDays(NOW, int(-60, 330))),
    }, ago(int(5, 420)));
  }
  if (has('aics')) {
    const pool = [...seniorListed, ...seniorListed, ...pwds, ...pwds, ...soloListed, ...soloListed, ...some(adults, 500)].filter((p) => !deceased.has(p.key) && p.age >= 18);
    for (let i = 0; i < 640; i++) {
      const p = pick(pool);
      const type = weighted(['Medicine', 34], ['Medical', 22], ['Hospital Bill', 18], ['Burial', 15], ['Eyeglasses', 11]);
      const amount = { Medicine: roundTo(int(1000, 3000), 500), Medical: roundTo(int(2000, 5000), 500), 'Hospital Bill': roundTo(int(3000, 10000), 1000), Burial: roundTo(int(5000, 10000), 1000), Eyeglasses: roundTo(int(800, 1500), 100) }[type];
      const released = seasonal([1, 1, 1, 1, 1, 1.1, 1.3, 1.5, 1.6, 1.3, 1.1, 1.2]);
      const self = type !== 'Burial' && chance(0.55);
      rec('aics', p, {
        assistance_type: type, amount_granted_php: amount, date_released: iso(released), voucher_control_no: `AICS-${released.getFullYear()}-${digits(5)}`,
        patient_deceased_name: self ? full(p) : `${pick([...FIRST_M, ...FIRST_F])} ${p.lname}`.toUpperCase(),
        relationship_to_patient_deceased: self ? 'Self' : weighted(['Spouse', 24], ['Child', 22], ['Parent', 30], ['Sibling', 12], ['Grandparent', 6], ['Other Relative', 6]),
        hospital_pharmacy_funeral_parlor: type === 'Burial' ? pick(['ST. PETER MEMORIAL CHAPELS', 'VIGAN FUNERAL HOMES', 'REYES FUNERAL PARLOR']) : type === 'Medicine' || type === 'Eyeglasses' ? pick(['MERCURY DRUG VIGAN', 'SOUTH STAR DRUG', 'VIGAN OPTICAL CLINIC', 'TGP VIGAN']) : pick(['GABRIELA SILANG GENERAL HOSPITAL', 'METRO VIGAN HOSPITAL', 'ILOCOS SUR DISTRICT HOSPITAL']),
        referred_by: weighted(['Walk-in', 44], ['Barangay', 26], ['Hospital', 14], ['Mayor\'s Office', 12], ['Other Office', 4]),
      }, released);
    }
  }
  for (const p of alive.filter((x) => x.age >= 3 && x.age <= 4)) {
    if (!reach(p, 0.74, 0.42)) continue;
    const guardian = people.find((x) => x.key === p.hh);
    rec('day_care', p, {
      child_development_center: pick(CDC), school_year: '2026-2027', guardian_name: guardian ? full(guardian) : '',
      nutritional_status_at_entry: weighted(['Normal', 84], ['Underweight', 12], ['Overweight', 4]), with_birth_certificate: chance(0.93),
    }, ago(int(60, 125)));
  }

  // Agriculture
  const farmers = alive.filter((p) => p.occupation === 'Farmer' && reach(p, 0.86, 0.6));
  for (const p of farmers) {
    rec('farmers', p, {
      farm_land_hectare: roundTo(0.25 + rng() * rng() * 3.5, 0.05), rsbsa_no: `01-29-34-${p.brgy.code.slice(-3)}-${digits(6)}`, farm_location_barangay_sitio: p.brgy.name.toUpperCase(),
      main_commodity: weighted(['Rice', 34], ['Corn', 18], ['Tobacco', 14], ['Vegetables', 20], ['Fruits', 4], ['Livestock', 6], ['Poultry', 3], ['Fisheries', 1]),
      tenure_status: weighted(['Owner-Cultivator', 46], ['Tenant', 30], ['Lessee', 8], ['Farm Worker', 16]), irrigated: chance(0.45),
    }, ago(int(5, 600)));
  }
  for (const p of some(farmers, Math.floor(farmers.length * 0.62))) {
    for (let i = 0; i < weighted([1, 60], [2, 30], [3, 10]); i++) {
      const assistance = weighted(['Certified Rice Seeds', 30], ['Hybrid Corn Seeds', 14], ['Fertilizer', 28], ['Vegetable Seeds', 14], ['Farm Tools', 6], ['Livestock Dispersal', 4], ['Fuel Subsidy', 4]);
      const [quantity, unit, value] = ({
        'Certified Rice Seeds': [int(1, 4), 'Bags', 1520], 'Hybrid Corn Seeds': [int(1, 3), 'Bags', 4800], Fertilizer: [int(2, 6), 'Bags', 1650], 'Vegetable Seeds': [int(2, 10), 'Packs', 180],
        'Farm Tools': [int(1, 3), 'Pieces', 950], 'Livestock Dispersal': [int(1, 2), 'Heads', 8500], 'Fuel Subsidy': [int(20, 60), 'Liters', 62],
      } as Record<string, [number, string, number]>)[assistance] as [number, string, number];
      const released = seasonal([0.4, 0.3, 0.3, 0.5, 1.4, 2, 1.6, 0.6, 0.4, 0.9, 1.6, 1]);
      rec('farm_assistance', p, { date_released: iso(released), assistance, cropping_season: released.getMonth() >= 4 && released.getMonth() <= 8 ? 'Wet Season' : 'Dry Season', quantity, unit, estimated_value_php: quantity * value }, released);
    }
  }
  for (const p of alive.filter((x) => x.occupation === 'Fisherman' || x.occupation === 'Fish Vendor')) {
    const vendor = p.occupation === 'Fish Vendor';
    const boat = vendor ? 'None' : weighted(['Motorized', 48], ['Non-motorized', 38], ['None', 14]);
    rec('fisherfolk', p, {
      fishr_no: `FR-012934-${digits(6)}`, fishing_type: vendor ? weighted(['Fish Vending', 75], ['Fish Processing', 25]) : weighted(['Municipal Capture Fishing', 72], ['Aquaculture / Fishpond', 16], ['Gleaning', 12]),
      boat_type: boat, boat_registered: boat !== 'None' && chance(0.64), years_fishing: int(1, Math.max(2, p.age - 17)),
    }, ago(int(10, 500)));
  }

  // Civil registry
  for (const p of alive.filter((x) => x.age < 1)) {
    if (!chance(0.94)) continue;
    const late = chance(0.08);
    const registered = addDays(p.bdate, late ? int(60, 200) : int(3, 28));
    const head = people.find((x) => x.key === p.hh);
    rec('birth', p, {
      registry_no: `${registered.getFullYear()}-B-${digits(4)}`, place_of_birth: weighted(['GABRIELA SILANG GENERAL HOSPITAL', 52], ['METRO VIGAN HOSPITAL', 24], ['VIGAN CITY BIRTHING CENTER', 16], ['RESIDENCE', 8]),
      mother_s_maiden_name: `${pick(FIRST_F)} ${p.mname}`.toUpperCase(), father_s_name: head ? `${pick(FIRST_M)} ${head.lname}`.toUpperCase() : '',
      date_registered: iso(registered), late_registration: late,
    }, registered);
  }
  for (const p of some(adults.filter((x) => x.civil === 'Married' && x.age <= 44), 115)) {
    const wed = seasonal([1.6, 1.8, 0.8, 0.9, 1.5, 1.7, 0.7, 0.5, 0.6, 0.8, 0.9, 2]);
    const ceremony = weighted(['Civil', 52], ['Church', 40], ['Other Religious Rites', 8]);
    rec('marriage', p, {
      registry_no: `${wed.getFullYear()}-M-${digits(4)}`, date_of_marriage: iso(wed), spouse_name: `${pick(p.sex === 'M' ? FIRST_F : FIRST_M)} ${pick(SURNAMES)}`.toUpperCase(),
      place_of_marriage: ceremony === 'Civil' ? 'VIGAN CITY HALL' : weighted(['VIGAN CATHEDRAL', 60], ['ST. AUGUSTINE CHURCH, BANTAY', 20], ['SIMBAAN A BASSIT', 20]),
      type_of_ceremony: ceremony, date_registered: iso(addDays(wed, int(2, 14))),
    }, addDays(wed, int(2, 14)));
  }

  // Health
  const everyone = [...alive, ...seniors.filter((p) => !deceased.has(p.key)), ...under5, ...under5];
  for (let i = 0; i < 1400; i++) {
    const p = pick(everyone);
    const diagnosis = p.age < 12
      ? weighted(['Respiratory Infection', 46], ['Gastrointestinal', 16], ['Skin Condition', 12], ['Dengue', 8], ['Injury / Wound', 8], ['Other', 10])
      : p.age >= 45
        ? weighted(['Hypertension', 36], ['Diabetes', 18], ['Respiratory Infection', 16], ['Tuberculosis', 4], ['Gastrointestinal', 6], ['Skin Condition', 4], ['Injury / Wound', 6], ['Other', 10])
        : weighted(['Respiratory Infection', 30], ['Injury / Wound', 14], ['Gastrointestinal', 12], ['Skin Condition', 10], ['Hypertension', 8], ['Dengue', 6], ['Tuberculosis', 4], ['Other', 16]);
    const seen = seasonal([1.3, 1.2, 1, 0.9, 0.9, 1.1, 1.4, 1.5, 1.4, 1.1, 1, 1.2]);
    rec('consultations', p, {
      consultation_date: iso(seen), diagnosis_category: diagnosis,
      facility: weighted(['City Health Office', 48], ['Barangay Health Station', 40], ['Gabriela Silang General Hospital', 12]),
      referred_to_hospital: chance(diagnosis === 'Dengue' ? 0.4 : 0.06), philhealth_member: chance(0.62),
    }, seen);
  }
  for (const p of under5) {
    if (!reach(p, 0.84, 0.5)) continue;
    const doses: Array<[string, string, number]> = [['BCG', '1st Dose', 3], ['Hepatitis B', '1st Dose', 3], ['Pentavalent', '1st Dose', 45], ['OPV', '1st Dose', 45], ['PCV', '1st Dose', 45], ['Pentavalent', '2nd Dose', 75], ['OPV', '2nd Dose', 75], ['Pentavalent', '3rd Dose', 105], ['MMR', '1st Dose', 275], ['MMR', '2nd Dose', 370]];
    for (const [vaccine, dose, atDays] of doses) {
      const given = addDays(p.bdate, atDays + int(0, 20));
      if (given.getTime() > NOW.getTime() || given.getTime() < ago(365).getTime() || !chance(0.9)) continue;
      rec('immunization', p, { date_given: iso(given), vaccine, dose, facility: weighted(['Barangay Health Station', 62], ['City Health Office', 34], ['Gabriela Silang General Hospital', 4]) }, given);
    }
  }
  for (const p of some(seniorListed.filter((x) => !deceased.has(x.key)), 150)) {
    const given = seasonal([0.3, 0.3, 0.3, 0.4, 0.6, 1.6, 2, 1.6, 1, 0.6, 0.4, 0.3]);
    rec('immunization', p, { date_given: iso(given), vaccine: weighted(['Flu', 78], ['COVID-19 Booster', 22]), dose: 'Booster', facility: weighted(['City Health Office', 55], ['Barangay Health Station', 45]) }, given);
  }
  for (const p of under5) {
    if (!reach(p, 0.86, 0.55)) continue;
    const months = Math.max(1, Math.floor((NOW.getTime() - p.bdate.getTime()) / (30.44 * DAY)));
    const worse = LESS_REACHED.has(p.brgy.name) || p.brgy.kind === 'flood' ? 1.9 : 1;
    const status = weighted(['Normal', 82], ['Underweight', 8 * worse], ['Severely Underweight', 1.5 * worse], ['Stunted', 4.5 * worse], ['Wasted', 2 * worse], ['Overweight', 2]);
    const factor = status === 'Normal' ? 1 : status === 'Overweight' ? 1.22 : status === 'Severely Underweight' ? 0.7 : 0.82;
    const weighed = ago(int(10, 170));
    rec('nutrition', p, {
      date_weighed: iso(weighed), weight_kg: roundTo((3.3 + months * 0.24) * factor * (0.94 + rng() * 0.12), 0.1), height_cm: roundTo((50 + months * 1.05) * (status === 'Stunted' ? 0.9 : 1) * (0.97 + rng() * 0.06), 0.5),
      nutritional_status: status, feeding_program_enrolled: status !== 'Normal' && status !== 'Overweight' && chance(0.7),
    }, weighed);
  }
  const dengueSeason = [0.2, 0.2, 0.2, 0.3, 0.5, 1, 2, 2.6, 2.4, 1.6, 0.8, 0.3];
  const hotspotPeople = alive.filter((p) => DENGUE_HOTSPOTS.has(p.brgy.name));
  const diseases: Array<[string, number, number[], (p: Person) => boolean]> = [
    ['Dengue', 170, dengueSeason, (p) => p.age < 40],
    ['Influenza-like Illness', 90, [2, 1.8, 1, 0.6, 0.5, 0.8, 1.4, 1.6, 1.2, 0.9, 1, 1.8], () => true],
    ['Tuberculosis', 42, FLAT, (p) => p.age >= 25],
    ['Hand, Foot and Mouth Disease', 38, [0.6, 0.6, 0.8, 1, 1, 1.6, 1.8, 1.4, 1, 0.8, 0.6, 0.5], (p) => p.age < 8],
    ['Leptospirosis', 24, [0.1, 0.1, 0.1, 0.2, 0.4, 0.9, 1.6, 2.2, 2.2, 1.6, 0.6, 0.2], (p) => p.age >= 15 && p.age < 60],
    ['Typhoid Fever', 20, FLAT, () => true],
    ['Measles', 10, FLAT, (p) => p.age < 10],
  ];
  for (const [disease, n, season, who] of diseases) {
    const pool = alive.filter(who);
    for (let i = 0; i < n; i++) {
      const p = pick(disease === 'Dengue' && chance(0.55) ? hotspotPeople.filter(who) : disease === 'Leptospirosis' && chance(0.7) ? pool.filter((x) => x.brgy.kind === 'flood') : pool);
      const reported = seasonal(season);
      const hospitalized = chance(disease === 'Dengue' ? 0.46 : disease === 'Leptospirosis' ? 0.6 : 0.12);
      const recent = reported.getTime() > ago(14).getTime();
      rec('disease_cases', p, {
        date_reported: iso(reported), disease, hospitalized,
        outcome: disease === 'Tuberculosis' ? weighted(['Under Treatment', 62], ['Recovered', 36], ['Died', 2]) : recent ? (hospitalized ? 'Admitted' : 'Under Treatment') : weighted(['Recovered', 97], ['Died', disease === 'Dengue' || disease === 'Leptospirosis' ? 1.2 : 0.2]),
      }, reported);
    }
  }
  const mothers = some(adults.filter((p) => p.sex === 'F' && p.age <= 42 && p.civil !== 'Widowed'), 135);
  mothers.forEach((p, i) => {
    const current = i < 82;
    const edd = current ? addDays(NOW, int(5, 220)) : ago(int(45, 240));
    const visits = int(1, 3);
    for (let v = 0; v < visits; v++) {
      const visit = addDays(edd, -int(30 + v * 55, 75 + v * 55));
      if (visit.getTime() > NOW.getTime() || visit.getTime() < ago(365).getTime()) continue;
      const weeks = 40 - Math.round((edd.getTime() - visit.getTime()) / (7 * DAY));
      rec('prenatal', p, { visit_date: iso(visit), trimester: weeks < 13 ? 'First' : weeks < 27 ? 'Second' : 'Third', risk_level: p.age < 20 || p.age > 36 ? weighted(['High', 55], ['Low', 45]) : weighted(['Low', 88], ['High', 12]), expected_delivery_date: iso(edd) }, visit);
    }
  });

  // Disaster: one typhoon two weeks ago, and a smaller flood in July.
  const typhoon = ago(16);
  const floodHeads = alive.filter((p) => p.isHead && p.brgy.kind === 'flood');
  for (const p of some(floodHeads, Math.floor(floodHeads.length * 0.42))) {
    rec('evacuees', p, {
      date_evacuated: iso(typhoon), event: 'Typhoon', family_size: p.hhSize, returned_home: chance(0.72),
      evacuation_center: weighted(['Tamag Barangay Hall', 30], ['Pantay Daya Chapel', 28], ['Vigan City Hall Gym', 24], ['Ayusan Norte Covered Court', 10], ['Bulala Elementary School', 8]),
    }, typhoon);
  }
  const reliefData = (p: Person, event: string, on: Date) => ({
    event, distribution_date: iso(on), distribution_site: `${p.brgy.name} BARANGAY HALL`.toUpperCase(),
    items_received: weighted([['Food pack', 'Rice', 'Drinking water'], 50], [['Food pack', 'Hygiene kit'], 25], [['Food pack', 'Rice', 'Sleeping kit', 'Hygiene kit'], 15], [['Food pack', 'Cash assistance'], 10]),
    family_packs: p.hhSize > 5 ? 2 : 1, family_size: p.hhSize, received_by: full(p),
  });
  for (const p of alive.filter((x) => x.isHead)) {
    const vulnerable = people.some((x) => x.hh === p.hh && (x.age >= 60 || x.age < 5));
    if (p.brgy.kind === 'flood' && chance(0.3)) rec('relief_distribution', p, reliefData(p, 'JULY 2026 FLOODING', ago(int(78, 84))), ago(78));
    if (chance(p.brgy.kind === 'flood' ? 0.9 : vulnerable ? 0.78 : 0.15)) {
      const on = addDays(typhoon, int(1, 9));
      rec('relief_distribution', p, reliefData(p, 'TYPHOON KRISTINE', on), on);
    }
  }
  const allBrgy = (weightFlood = 1) => weighted(...barangays.map((b) => [b.name, b.kind === 'flood' ? 2 * weightFlood : b.kind === 'poblacion' ? 1.6 : 1] as const));
  for (let i = 0; i < 180; i++) {
    const type = weighted(['Road Crash', 34], ['Medical Emergency', 28], ['Flood', 12], ['Fire', 9], ['Typhoon Damage', 12], ['Drowning', 3], ['Landslide', 2]);
    const storm = type === 'Flood' || type === 'Typhoon Damage';
    const on = storm && chance(0.5) ? addDays(typhoon, int(0, 3)) : seasonal(storm ? [0.1, 0.1, 0.1, 0.2, 0.4, 1, 1.8, 2.2, 2.2, 1.6, 0.8, 0.3] : FLAT);
    rec('incidents', null, {
      incident_date: iso(on), incident_type: type, incident_barangay: allBrgy(storm ? 4 : 1), injured: type === 'Road Crash' ? int(0, 3) : int(0, 1),
      casualties: chance(type === 'Drowning' ? 0.5 : 0.02) ? 1 : 0, families_affected: storm ? int(3, 60) : type === 'Fire' ? int(1, 6) : 0, response_time_minutes: int(5, 24),
    }, on);
  }

  // Jobs, youth, livelihood
  const seekers = some(alive.filter((p) => p.age >= 18 && p.age <= 40 && (p.occupation === 'None' || p.occupation === 'Laborer' || p.occupation === 'Student' || chance(0.1))), 380);
  for (const p of seekers) {
    const on = seasonal([1, 1, 1.2, 1.6, 1.8, 1.4, 1, 0.9, 0.9, 1, 0.9, 0.7]);
    rec('jobseekers', p, {
      date_registered: iso(on), highest_education: weighted(['High School Graduate', 36], ['College Graduate', 26], ['Vocational / TESDA', 14], ['College Level', 18], ['Elementary', 6]),
      preferred_field: weighted(['Sales / Retail', 20], ['Hotel & Restaurant', 22], ['Construction', 12], ['Office / Clerical', 14], ['IT / BPO', 10], ['Driving / Delivery', 9], ['Healthcare', 7], ['Manufacturing', 6]),
      employment_status: weighted(['Unemployed', 62], ['Underemployed', 26], ['Employed, seeking better job', 12]),
    }, on);
    if (!chance(0.41)) continue;
    const placed = addDays(on, int(10, 90));
    if (placed.getTime() > NOW.getTime()) continue;
    const overseas = chance(0.13);
    rec('placements', p, { placement_date: iso(placed), industry: weighted(['Retail', 22], ['Hotel & Restaurant', 26], ['Construction', 14], ['BPO', 10], ['Manufacturing', 8], ['Healthcare', 8], ['Government', 12]), placement_type: overseas ? 'Overseas' : 'Local', monthly_salary_php: overseas ? roundTo(int(28000, 65000), 1000) : roundTo(int(11000, 22000), 500) }, placed);
  }
  const scholars = some(alive.filter((p) => p.age >= 17 && p.age <= 23), 135);
  for (const p of scholars) {
    rec('scholars', p, {
      date_enrolled: iso(ago(int(60, 420))), school: weighted(['University of Northern Philippines', 52], ['Divine Word College of Vigan', 16], ['St. Paul College of Ilocos Sur', 12], ['Ilocos Sur Polytechnic State College', 14], ['Other', 6]),
      course: weighted(['Education', 20], ['Nursing', 14], ['Information Technology', 16], ['Criminology', 14], ['Business Administration', 14], ['Engineering', 10], ['Tourism & Hospitality', 8], ['Agriculture', 4]),
      year_level: weighted(['1st Year', 32], ['2nd Year', 28], ['3rd Year', 22], ['4th Year', 18]), grant_amount_php: pick([10000, 15000, 20000]), status: weighted(['Active', 86], ['Graduated', 10], ['Terminated', 4]),
    }, ago(int(60, 420)));
  }
  for (const p of [...some(scholars, 40), ...some(youth.filter((x) => x.age <= 24), 60)]) {
    const start = ago(int(95, 150));
    const days = int(20, 30);
    rec('spes', p, { start_date: iso(start), school_level: weighted(['College', 55], ['Senior High School', 33], ['Out-of-school Youth', 12]), assigned_office: weighted(['City Hall', 34], ['Tourism Office', 20], ['City Library', 12], ['Public Market', 16], ['Health Office', 18]), days_worked: days, salary_received_php: days * 470 }, start);
  }
  for (const p of youth) {
    if (!reach(p, 0.62, 0.38)) continue;
    const studying = p.occupation === 'Student';
    rec('youth_profile', p, {
      date_profiled: iso(ago(int(20, 300))), youth_classification: studying ? 'In-school Youth' : p.occupation === 'None' ? weighted(['Out-of-school Youth', 82], ['Youth with Specific Needs', 18]) : weighted(['Working Youth', 84], ['Out-of-school Youth', 16]),
      educational_attainment: p.age < 18 ? 'High School Level' : weighted(['High School Graduate', 30], ['College Level', 32], ['College Graduate', 20], ['Vocational / TESDA', 12], ['High School Level', 6]),
      registered_sk_voter: chance(0.71), interested_in: weighted(['Sports', 30], ['Livelihood Training', 24], ['Scholarship', 20], ['Arts & Culture', 14], ['Volunteer Work', 12]),
    }, ago(int(20, 300)));
  }
  for (const p of some(adults.filter((x) => x.sex === 'F' || chance(0.4)), 160)) {
    const program = weighted(['Sustainable Livelihood Program', 30], ['Negosyo Starter Kit', 26], ['Skills Training', 22], ['Cooperative Loan', 12], ['Burnay / Abel Weaving Support', 10]);
    const on = ago(int(5, 360));
    rec('livelihood_beneficiaries', p, { date_released: iso(on), program, sector: program.startsWith('Burnay') ? 'Handicraft' : weighted(['Food Processing', 28], ['Retail', 30], ['Handicraft', 14], ['Agriculture', 14], ['Services', 14]), grant_loan_amount_php: program === 'Skills Training' ? 5000 : roundTo(int(10000, 30000), 5000), business_started: chance(0.66) }, on);
  }

  // Permits, taxes, city services
  const employers = ['HOTEL LUNA', 'CAFE LEONA', 'VIGAN PLAZA HOTEL', 'TONGSON ROYAL BIBINGKA', 'IRENE\'S VIGAN EMPANADA', 'GRANDPA\'S INN', 'PARTAS BUS TERMINAL', 'VIGAN PUBLIC MARKET', 'METRO VIGAN HOSPITAL', 'RG JAR FACTORY', 'CRISTY\'S LOOM WEAVING', 'SAVEMORE VIGAN', 'MAX\'S RESTAURANT VIGAN', 'HIDDEN GARDEN'];
  const working = adults.filter((p) => ['Sales Clerk', 'Hotel / Restaurant Staff', 'Vendor', 'Office Clerk', 'Laborer', 'Store Owner', 'Tour Guide'].includes(p.occupation ?? ''));
  for (const p of some(working, 260)) {
    const issued = seasonal([3, 2.2, 1, 0.6, 0.5, 0.6, 0.6, 0.5, 0.5, 0.5, 0.4, 0.4]);
    rec('occupational_permits', p, { occupational_permit_no: `OP-${issued.getFullYear()}-${digits(5)}`, employer_business_name: pick(employers), position_occupation: (p.occupation ?? 'STAFF').toUpperCase(), health_certificate_no: `HC-${issued.getFullYear()}-${digits(5)}`, date_issued: iso(issued), valid_until: `${issued.getFullYear()}-12-31` }, issued);
  }
  const heads = alive.filter((p) => p.isHead);
  for (const p of some(heads, 560)) {
    const paid = seasonal([2.6, 2, 2.4, 1, 0.7, 0.9, 0.6, 0.5, 0.7, 0.6, 0.6, 1.2]);
    const late = paid.getMonth() > 2 && chance(0.4);
    rec('rpt_payments', p, {
      payment_date: iso(paid), tax_declaration_no: `TD-${paid.getFullYear()}-${digits(5)}`, tax_year: late ? paid.getFullYear() - 1 : paid.getFullYear(),
      amount_paid_php: roundTo((p.brgy.kind === 'poblacion' ? int(6000, 48000) : int(1200, 14000)) * (late ? 1.24 : 1), 10),
      payment_type: late ? 'With Penalty (Delinquent)' : weighted(['Full Payment', 68], ['Installment', 32]), property_barangay: p.brgy.name,
    }, paid);
  }
  const shops = ['SARI-SARI STORE', 'EATERY', 'TRADING', 'SOUVENIR SHOP', 'BAKERY', 'PHARMACY', 'HARDWARE', 'LODGING HOUSE', 'SALON', 'LONGGANISA STORE'];
  for (let i = 0; i < 280; i++) {
    const paid = seasonal([4, 1, 0.5, 2, 0.5, 0.4, 1.8, 0.5, 0.4, 1.6, 0.4, 0.4]);
    const line = weighted(['Retail / Sari-sari Store', 34], ['Food & Beverage', 24], ['Accommodation', 10], ['Professional & Personal Services', 14], ['Heritage Crafts', 8], ['Wholesale', 10]);
    rec('business_tax_payments', null, {
      payment_date: iso(paid), business_name: `${pick(SURNAMES).toUpperCase()} ${pick(shops)}`, line_of_business: line, quarter: `Q${Math.floor(paid.getMonth() / 3) + 1}`,
      amount_paid_php: roundTo(line === 'Accommodation' || line === 'Wholesale' ? int(18000, 120000) : int(2500, 42000), 50),
    }, paid);
  }
  for (const p of some(heads, 85)) {
    const issued = seasonal([1.2, 1.4, 1.6, 1.5, 1.2, 0.8, 0.6, 0.6, 0.7, 1, 1.2, 1]);
    const use = weighted(['Residential', 62], ['Commercial', 22], ['Mixed Use', 10], ['Institutional', 6]);
    const area = use === 'Residential' ? int(40, 220) : int(80, 900);
    rec('building_permits', p, {
      date_issued: iso(issued), building_permit_no: `BP-${issued.getFullYear()}-${digits(4)}`, project_type: weighted(['New Construction', 46], ['Renovation', 26], ['Addition', 12], ['Repair', 12], ['Demolition', 4]),
      building_use: use, project_barangay: p.brgy.name, floor_area_sq_m: area, project_cost_php: roundTo(area * int(14000, 26000), 1000), within_heritage_zone: p.brgy.kind === 'poblacion' && chance(0.5),
    }, issued);
  }
  for (const p of some(heads, 420)) {
    const on = seasonal([1, 1, 2.4, 1.6, 1, 0.8, 0.8, 0.8, 1.6, 1, 0.8, 0.8]);
    const species = weighted(['Dog', 56], ['Cat', 16], ['Chicken', 8], ['Pig', 8], ['Goat', 5], ['Carabao', 3], ['Cattle', 4]);
    rec('animal_registration', p, { date_registered: iso(on), species, rabies_vaccinated: (species === 'Dog' || species === 'Cat') && chance(0.74) }, on);
  }
  for (let i = 0; i < 150; i++) {
    const p = pick(chance(0.45) ? alive.filter((x) => x.age < 15) : alive);
    const on = seasonal([0.8, 0.9, 1.4, 1.8, 1.8, 1.2, 0.9, 0.8, 0.8, 0.8, 0.9, 1]);
    rec('animal_bites', p, { date_of_bite: iso(on), biting_animal: weighted(['Dog', 78], ['Cat', 19], ['Other', 3]), exposure_category: weighted(['Category II', 58], ['Category III', 30], ['Category I', 12]), anti_rabies_vaccine_given: chance(0.86), bite_location_barangay: p.brgy.name }, on);
  }
  for (const p of some(adults, 140)) {
    const on = seasonal(FLAT);
    const violation = weighted(['Improper Waste Segregation', 40], ['Littering', 26], ['Illegal Dumping', 12], ['Open Burning', 14], ['Smoke Belching', 8]);
    rec('environmental_violations', p, { date_of_violation: iso(on), violation, violation_barangay: p.brgy.name, fine_php: violation === 'Illegal Dumping' ? 2500 : violation === 'Littering' ? 500 : 1000, status: weighted(['Paid', 58], ['Community Service', 18], ['Unpaid', 24]) }, on);
  }
  for (let i = 0; i < 45; i++) {
    const on = seasonal([0.4, 0.5, 0.6, 0.6, 0.8, 2.2, 2, 1.4, 1.2, 0.6, 0.5, 0.4]);
    rec('tree_planting', null, { date_planted: iso(on), site_barangay: pick(barangayNames), species: weighted(['Narra', 22], ['Mahogany', 26], ['Mango', 18], ['Bamboo', 18], ['Mangrove', 16]), trees_planted: roundTo(int(40, 600), 10), organized_by: weighted(['ENRO', 36], ['Barangay', 26], ['School', 24], ['Private Sector', 14]) }, on);
  }
  // Visitors: Holy Week and summer, the January fiesta, the December holidays.
  for (let i = 0; i < 560; i++) {
    const on = seasonal([1.8, 1.1, 1.4, 2.4, 2, 0.9, 0.7, 0.6, 0.6, 0.9, 1.1, 2.2]);
    const origin = weighted(['Domestic (other regions)', 58], ['Local (Ilocos Region)', 28], ['Foreign', 14]);
    const site = weighted(['Calle Crisologo', 30], ['Vigan Cathedral', 14], ['Plaza Salcedo', 14], ['Baluarte', 14], ['Syquia Mansion', 7], ['Hidden Garden', 8], ['Pagburnayan (Burnay)', 8], ['Crisologo Museum', 5]);
    rec('visitor_arrivals', null, { date: iso(on), visitor_origin: origin, destination: site, visitor_count: roundTo((origin === 'Foreign' ? int(15, 120) : int(60, 520)) * (site === 'Calle Crisologo' ? 1.6 : 1), 5) }, on);
  }
  for (let week = 0; week < 22; week++) {
    for (const b of barangays) {
      const households = people.filter((p) => p.isHead && p.brgy.code === b.code).length;
      const base = households * (b.kind === 'poblacion' ? 21 : 12) * (0.85 + rng() * 0.3);
      const on = ago(week * 7 + int(0, 2));
      const sorted = b.kind === 'poblacion' ? [0.44, 0.2, 0.36] : LESS_REACHED.has(b.name) ? [0.4, 0.1, 0.5] : [0.52, 0.18, 0.3];
      (['Biodegradable', 'Recyclable', 'Residual'] as const).forEach((type, t) => {
        rec('waste_collection', null, { collection_date: iso(on), barangay: b.name, waste_type: type, weight_kg: Math.round(base * (sorted[t] as number)) }, on);
      });
    }
  }

  // New offices
  for (let i = 0; i < 640; i++) {
    const on = seasonal([1.3, 1, 1, 1.5, 1.4, 0.9, 0.8, 0.8, 0.9, 1, 1, 1.5]);
    const vehicle = weighted(['Motorcycle', 46], ['Tricycle', 24], ['Private Car', 14], ['Van / SUV', 7], ['Truck', 4], ['Jeepney / Bus', 3], ['Kalesa', 2]);
    const violation = vehicle === 'Motorcycle'
      ? weighted(['No Helmet', 46], ['No Driver\'s License', 18], ['Unregistered Vehicle', 14], ['Reckless Driving', 10], ['Disregarding Traffic Sign', 12])
      : vehicle === 'Tricycle'
        ? weighted(['Overloading', 26], ['Colorum Operation', 22], ['Illegal Parking', 20], ['Obstruction', 16], ['Disregarding Traffic Sign', 16])
        : weighted(['Illegal Parking', 44], ['Obstruction', 18], ['Disregarding Traffic Sign', 18], ['Reckless Driving', 8], ['No Driver\'s License', 6], ['Unregistered Vehicle', 6]);
    const fine = ({ 'No Helmet': 1500, 'Illegal Parking': 500, 'No Driver\'s License': 3000, 'Unregistered Vehicle': 2000, Overloading: 500, Obstruction: 500, 'Disregarding Traffic Sign': 1000, 'Reckless Driving': 2000, 'Colorum Operation': 5000 } as Record<string, number>)[violation] ?? 500;
    rec('traffic_violations', null, {
      ticket_no: `TCT-${on.getFullYear()}-${digits(6)}`, date_of_violation: iso(on), violation, vehicle_type: vehicle,
      location: violation === 'Illegal Parking' ? weighted(['Calle Crisologo area', 34], ['Public Market', 30], ['Quezon Avenue', 20], ['Rizal Street', 16]) : pick(TRAFFIC_SPOTS),
      fine_php: fine, status: weighted(['Paid', 66], ['Unpaid', 29], ['Contested', 5]),
    }, on);
  }
  const drivers = people.filter((p) => p.occupation === 'Tricycle Driver' && (!deceased.has(p.key) || chance(0.2)));
  for (const p of drivers) {
    const issued = seasonal([2.4, 1.8, 1.2, 0.8, 0.6, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6], 430);
    const validUntil = addDays(issued, 365);
    const expired = validUntil.getTime() < NOW.getTime();
    rec('tricycle_franchise', p, {
      franchise_no: `MTOP-${issued.getFullYear()}-${digits(4)}`, body_no: digits(4), toda: p.brgy.kind === 'poblacion' ? weighted(['Poblacion TODA', 60], ['Public Market TODA', 40]) : pick(TODAS),
      date_issued: iso(issued), valid_until: iso(validUntil), franchise_status: expired ? 'Expired' : validUntil.getTime() < addDays(NOW, 60).getTime() ? 'For Renewal' : 'Active',
    }, issued);
  }
  const vendors = people.filter((p) => ['Vendor', 'Fish Vendor', 'Store Owner'].includes(p.occupation ?? '') && (!deceased.has(p.key) || chance(0.2)));
  some(vendors, 320).forEach((p, i) => {
    const section = p.occupation === 'Fish Vendor' ? 'Fish' : pick(MARKET_SECTIONS);
    const rent = ({ Meat: 3200, Fish: 2800, 'Vegetables & Fruits': 1800, 'Dry Goods': 2400, 'Rice & Grains': 2600, 'Carinderia / Eatery': 3600, 'Longganisa & Bagnet': 3000, 'Abel & Souvenirs': 2200 } as Record<string, number>)[section] ?? 2000;
    const behind = weighted([0, 68], [1, 12], [2, 8], [int(3, 9), 12]);
    const start = ago(int(60, 1400));
    rec('market_stalls', p, {
      stall_no: `${section.charAt(0)}-${String(i + 1).padStart(3, '0')}`, section, monthly_rental_php: rent, contract_start: iso(start), contract_end: iso(addDays(start, 365 * 3)),
      arrears_php: behind * rent, payment_standing: behind === 0 ? 'Up to date' : behind <= 2 ? '1 to 2 months behind' : '3 or more months behind',
    }, start.getTime() < ago(360).getTime() ? ago(int(200, 360)) : start);
  });
  for (let i = 0; i < 520; i++) {
    const on = seasonal([1.3, 1, 1, 1.2, 1.1, 1, 0.9, 0.9, 0.9, 1, 1.1, 1.6]);
    const type = weighted(['Stall Rental', 34], ['Daily Cash Ticket', 34], ['Slaughterhouse Fee', 16], ['Parking Fee', 10], ['Public Toilet', 6]);
    const amount = ({ 'Stall Rental': int(18000, 62000), 'Daily Cash Ticket': int(4500, 12500), 'Slaughterhouse Fee': int(3000, 9500), 'Parking Fee': int(900, 3200), 'Public Toilet': int(350, 1100) } as Record<string, number>)[type] ?? 1000;
    rec('market_collections', null, { payment_date: iso(on), collection_type: type, official_receipt_no: `OR-${digits(7)}`, amount_paid_php: roundTo(amount, 10) }, on);
  }
  const callers = alive.filter((p) => p.age >= 20);
  for (let i = 0; i < 1000; i++) {
    const p = pick(callers);
    const stormy = chance(0.12);
    const on = stormy ? addDays(typhoon, int(0, 10)) : seasonal([1, 1, 1, 1, 1.1, 1.3, 1.5, 1.6, 1.5, 1.2, 1, 1]);
    const category = stormy
      ? weighted(['Flooding', 44], ['Road / Drainage', 26], ['Financial Assistance', 18], ['Water Supply', 12])
      : weighted(['Road / Drainage', 17], ['Street Light', 14], ['Garbage Collection', 15], ['Noise / Public Disturbance', 9], ['Stray Animals', 10], ['Water Supply', 7], ['Financial Assistance', 13], ['Permit / Document Follow-up', 8], ['Flooding', 3], ['Others', 4]);
    const office = ({ 'Road / Drainage': 'City Engineering', 'Street Light': 'City Engineering', 'Garbage Collection': 'CENRO', 'Noise / Public Disturbance': 'POSO', 'Stray Animals': 'City Veterinary', 'Water Supply': 'City Engineering', 'Financial Assistance': 'CSWD', 'Permit / Document Follow-up': 'BPLO', Flooding: 'CDRRMO', Others: 'Mayor\'s Office' } as Record<string, string>)[category] ?? 'Mayor\'s Office';
    const slow = office === 'City Engineering';
    const days = slow ? int(4, 38) : int(1, 12);
    const resolved = addDays(on, days).getTime() < NOW.getTime() && chance(slow ? 0.78 : 0.93);
    rec('citizen_requests', p, {
      date_received: iso(on), channel: weighted(['Walk-in', 36], ['Phone / Hotline', 22], ['Facebook Page', 24], ['Barangay Referral', 14], ['8888 Referral', 4]), category, concern_barangay: p.brgy.name, referred_office: office,
      request_status: resolved ? 'Resolved' : weighted(['In Progress', 62], ['Pending', 38]), ...(resolved ? { days_to_resolve: days, satisfaction: days > 20 ? weighted(['Satisfied', 30], ['Neutral', 38], ['Dissatisfied', 32]) : weighted(['Very Satisfied', 40], ['Satisfied', 42], ['Neutral', 13], ['Dissatisfied', 5]) } : {}),
    }, on);
  }

  // Planning, engineering and tourism registers
  for (const p of some(heads, 150)) {
    const filed = seasonal([1.1, 1.3, 1.5, 1.4, 1.2, 0.9, 0.7, 0.7, 0.8, 1, 1.1, 0.9]);
    const type = weighted(['Residential', 52], ['Commercial', 24], ['Mixed Use', 10], ['Institutional', 6], ['Industrial', 3], ['Agricultural', 5]);
    const heritage = p.brgy.kind === 'poblacion' && chance(0.55);
    const lot = type === 'Residential' ? int(80, 400) : int(150, 1800);
    const decided = addDays(filed, int(5, 30));
    const pending = decided.getTime() > NOW.getTime();
    rec('zoning_clearance', p, {
      application_no: `LC-${filed.getFullYear()}-${digits(4)}`, project_title: `${type === 'Residential' ? 'RESIDENTIAL HOUSE' : type.toUpperCase() + ' BUILDING'} OF ${full(p)}`,
      project_type: type, project_location_barangay_street: `${p.brgy.name}`.toUpperCase(), lot_area_sq_m: lot, total_floor_area_sq_m: Math.round(lot * (0.4 + rng() * 0.6)),
      zoning_classification: heritage ? weighted(['Heritage Core Zone', 45], ['Heritage Buffer Zone', 55]) : type === 'Mixed Use' ? 'Commercial' : type,
      within_heritage_core_or_buffer_zone: heritage, project_cost_php: roundTo(lot * int(9000, 22000), 10000), date_filed: iso(filed),
      decision: pending ? 'Pending' : heritage ? weighted(['Approved with Conditions', 52], ['Approved', 30], ['Denied', 18]) : weighted(['Approved', 78], ['Approved with Conditions', 16], ['Denied', 6]),
      ...(pending ? {} : { date_of_decision: iso(decided) }),
    }, filed);
  }
  for (const p of some(heads, 80)) {
    const issued = seasonal([1, 1, 1.2, 1.2, 1.3, 1.1, 0.9, 0.8, 0.8, 1, 1.1, 1.2]);
    rec('occupancy_permits', p, { date_issued: iso(issued), occupancy_permit_no: `OCC-${issued.getFullYear()}-${digits(4)}`, property_barangay: p.brgy.name, floor_area_sq_m: int(40, 600) }, issued);
  }
  for (const p of some(adults.filter((x) => x.brgy.kind === 'poblacion' && x.age >= 21), 90)) {
    const on = ago(int(20, 640));
    rec('tour_guides', p, { accreditation_date: iso(on), accreditation_no: `TG-${on.getFullYear()}-${digits(3)}`, primary_language: weighted(['English', 46], ['Filipino', 24], ['Ilocano', 14], ['Japanese', 5], ['Korean', 6], ['Mandarin', 5]), valid_until: iso(addDays(on, 730)) }, on);
  }

  for (let i = 0; i < records.length; i += 1000) await prisma.officeRecord.createMany({ data: records.slice(i, i + 1000) });
  console.log(`  ${records.length} sample records:`);
  console.log('   ' + [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([slug, n]) => `${slug} ${n}`).join(', '));

  // --- Program gap rules ---
  const rule = async (name: string, kind: 'missing' | 'conflict', target: string, opts: { sources?: string[]; minAge?: number; maxAge?: number; description?: string }) => {
    const targetModuleId = moduleId.get(target);
    const sourceModuleIds = (opts.sources ?? []).map((s) => moduleId.get(s));
    if (!targetModuleId || sourceModuleIds.some((s) => !s) || (await prisma.programGapRule.findFirst({ where: { name } }))) return;
    await prisma.programGapRule.create({ data: { name, kind, targetModuleId, sourceModuleIds: sourceModuleIds as string[], minAge: opts.minAge, maxAge: opts.maxAge, description: opts.description, createdBy: DEMO_ACTOR, updatedBy: DEMO_ACTOR } });
  };
  await rule('Children aged 3 to 4 not in day care', 'missing', 'day_care', { minAge: 3, maxAge: 4 });
  await rule('Children under 5 not yet weighed (Operation Timbang)', 'missing', 'nutrition', { maxAge: 4 });
  await rule('Farmers who have not received farm inputs', 'missing', 'farm_assistance', { sources: ['farmers'] });
  await rule('Youth aged 15 to 30 not yet profiled', 'missing', 'youth_profile', { minAge: 15, maxAge: 30 });
  await rule('Deceased still holding a tricycle franchise', 'conflict', 'tricycle_franchise', { sources: ['death'] });
  await rule('Deceased still leasing a market stall', 'conflict', 'market_stalls', { sources: ['death'] });

  // --- Charts ---
  let sort = (await prisma.dashboardWidget.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1;
  let charts = 0;
  type ChartOpts = { measure?: string; where?: [key: string, value: string] };
  const chart = async (title: string, sources: string[], chartType: 'bar' | 'line' | 'donut' | 'number', groupBy: string[], opts: ChartOpts = {}) => {
    const ids = sources.map((s) => moduleId.get(s));
    if (ids.some((id) => !id) || (await prisma.dashboardWidget.findFirst({ where: { title } }))) return;
    await prisma.dashboardWidget.create({
      data: {
        title, chartType, groupBy, measure: opts.measure ?? 'count', sortOrder: ++sort, createdBy: DEMO_ACTOR,
        filterFieldKey: opts.where?.[0], filterFieldValue: opts.where?.[1], sources: { create: (ids as string[]).map((id) => ({ moduleId: id })) },
      },
    });
    charts++;
  };
  // Across offices
  await chart('City collections per month: property tax, business tax, market', ['rpt_payments', 'business_tax_payments', 'market_collections'], 'line', ['month'], { measure: 'sum:amount_paid_php' });
  await chart('Typhoon response by barangay: families evacuated and relief given', ['evacuees', 'relief_distribution'], 'bar', ['barangay']);
  await chart('Children reached by barangay: immunization, weighing, day care', ['immunization', 'nutrition', 'day_care'], 'bar', ['barangay'], { measure: 'people' });
  await chart('Social welfare clients by barangay', ['senior_citizen', 'pwd', 'solo_parent', 'aics'], 'bar', ['barangay'], { measure: 'people' });
  await chart('Births, marriages and deaths registered per month', ['birth', 'marriage', 'death'], 'line', ['month']);
  await chart('Public health watch per month: disease cases and animal bites', ['disease_cases', 'animal_bites'], 'line', ['month']);
  await chart('Enforcement per month: traffic and environmental violations', ['traffic_violations', 'environmental_violations'], 'line', ['month']);
  await chart('Fines assessed per month: traffic and environment', ['traffic_violations', 'environmental_violations'], 'line', ['month'], { measure: 'sum:fine_php' });
  await chart('Youth reached by program and sex', ['youth_profile', 'scholars', 'spes', 'jobseekers'], 'bar', ['sex'], { measure: 'people' });
  await chart('Jobs and livelihood by barangay', ['jobseekers', 'placements', 'livelihood_beneficiaries', 'farm_assistance'], 'bar', ['barangay'], { measure: 'people' });
  await chart('Farmers and fisherfolk by barangay', ['farmers', 'fisherfolk'], 'bar', ['barangay']);
  // CSWD
  await chart('AICS assistance released per month (PHP)', ['aics'], 'line', ['month'], { measure: 'sum:amount_granted_php' });
  await chart('AICS amount by type of assistance', ['aics'], 'donut', ['field:assistance_type'], { measure: 'sum:amount_granted_php' });
  await chart('AICS clients who are also in other CSWD programs', ['aics'], 'bar', ['other_programs'], { measure: 'people' });
  await chart('Senior citizens by living arrangement', ['senior_citizen'], 'donut', ['field:living_arrangement']);
  await chart('Senior citizens by pension source', ['senior_citizen'], 'donut', ['field:pension_source']);
  await chart('Persons with disability by type', ['pwd'], 'bar', ['field:type_of_disability']);
  await chart('Solo parents by category', ['solo_parent'], 'bar', ['field:solo_parent_category']);
  await chart('Day care children by center', ['day_care'], 'bar', ['field:child_development_center']);
  // Health
  await chart('Disease cases by disease', ['disease_cases'], 'bar', ['field:disease']);
  await chart('Dengue cases per month', ['disease_cases'], 'line', ['month'], { where: ['disease', 'Dengue'] });
  await chart('Dengue cases by barangay', ['disease_cases'], 'bar', ['barangay'], { where: ['disease', 'Dengue'] });
  await chart('Children under 5 by nutritional status', ['nutrition'], 'donut', ['field:nutritional_status']);
  await chart('Underweight children by barangay', ['nutrition'], 'bar', ['barangay'], { where: ['nutritional_status', 'Underweight'] });
  await chart('Children in the feeding program by barangay', ['nutrition'], 'bar', ['barangay'], { where: ['feeding_program_enrolled', 'true'] });
  // Agriculture
  await chart('Farmers by main commodity', ['farmers'], 'donut', ['field:main_commodity']);
  await chart('Farm land by commodity (hectares)', ['farmers'], 'bar', ['field:main_commodity'], { measure: 'sum:farm_land_hectare' });
  await chart('Farm inputs distributed by kind (PHP)', ['farm_assistance'], 'bar', ['field:assistance'], { measure: 'sum:estimated_value_php' });
  await chart('Farm inputs released per month (PHP)', ['farm_assistance'], 'line', ['month'], { measure: 'sum:estimated_value_php' });
  await chart('Fisherfolk by fishing activity', ['fisherfolk'], 'donut', ['field:fishing_type']);
  // Civil registry
  await chart('Deaths by cause', ['death'], 'bar', ['field:cause_of_death']);
  await chart('Marriages by type of ceremony', ['marriage'], 'donut', ['field:type_of_ceremony']);
  await chart('Births registered late', ['birth'], 'donut', ['field:late_registration']);
  // CDRRMO
  await chart('Relief packs given by distribution site', ['relief_distribution'], 'bar', ['field:distribution_site'], { measure: 'sum:family_packs' });
  await chart('Families still in evacuation centers', ['evacuees'], 'bar', ['field:evacuation_center'], { where: ['returned_home', 'false'] });
  // CENRO
  await chart('Waste collected per month (kg)', ['waste_collection'], 'line', ['month'], { measure: 'sum:weight_kg' });
  await chart('Waste collected by type (kg)', ['waste_collection'], 'donut', ['field:waste_type'], { measure: 'sum:weight_kg' });
  await chart('Residual waste by barangay (kg)', ['waste_collection'], 'bar', ['field:barangay'], { measure: 'sum:weight_kg', where: ['waste_type', 'Residual'] });
  // POSO
  await chart('Traffic violations by kind', ['traffic_violations'], 'bar', ['field:violation']);
  await chart('Traffic violations by vehicle', ['traffic_violations'], 'donut', ['field:vehicle_type']);
  await chart('Traffic violations by location', ['traffic_violations'], 'bar', ['field:location']);
  await chart('Traffic fines by payment status (PHP)', ['traffic_violations'], 'donut', ['field:status'], { measure: 'sum:fine_php' });
  await chart('Tricycle franchises by TODA', ['tricycle_franchise'], 'bar', ['field:toda']);
  await chart('Tricycle franchises by status', ['tricycle_franchise'], 'donut', ['field:franchise_status']);
  // Economic enterprise
  await chart('Market stalls by section', ['market_stalls'], 'bar', ['field:section']);
  await chart('Market stall lessees by payment standing', ['market_stalls'], 'donut', ['field:payment_standing']);
  await chart('Unpaid stall rental by section (PHP)', ['market_stalls'], 'bar', ['field:section'], { measure: 'sum:arrears_php' });
  await chart('Market collections by source (PHP)', ['market_collections'], 'donut', ['field:collection_type'], { measure: 'sum:amount_paid_php' });
  // Public assistance
  await chart('Requests and complaints by concern', ['citizen_requests'], 'bar', ['field:category']);
  await chart('Requests and complaints per month', ['citizen_requests'], 'line', ['month']);
  await chart('Requests and complaints by status', ['citizen_requests'], 'donut', ['field:request_status']);
  await chart('Open requests by office responsible', ['citizen_requests'], 'bar', ['field:referred_office'], { where: ['request_status', 'In Progress'] });
  await chart('Requests and complaints by barangay', ['citizen_requests'], 'bar', ['field:concern_barangay']);
  await chart('Client satisfaction on resolved requests', ['citizen_requests'], 'donut', ['field:satisfaction'], { where: ['request_status', 'Resolved'] });
  // Youth
  await chart('Youth by classification', ['youth_profile'], 'donut', ['field:youth_classification']);
  await chart('Out-of-school youth by barangay', ['youth_profile'], 'bar', ['barangay'], { where: ['youth_classification', 'Out-of-school Youth'] });
  await chart('What youth are most interested in', ['youth_profile'], 'bar', ['field:interested_in']);
  // BPLO
  await chart('Occupational permits issued per month', ['occupational_permits'], 'line', ['month']);
  console.log(`  ${charts} charts, and program gap rules for the new programs`);
}

async function main() {
  const mode = process.argv.includes('--remove') ? 'remove' : process.argv.includes('--reset') ? 'reset' : 'add';
  const existing = await prisma.citizen.count({ where: { createdBy: DEMO_ACTOR } });
  if (process.argv.includes('--outreach')) {
    await addOutreach();
    return;
  }
  if (mode === 'add' && existing > 0) {
    console.log(`The demo data is already here (${existing} sample citizens). Use --reset to rebuild it or --remove to take it out.`);
    return;
  }
  if (mode !== 'add') await removeDemo();
  if (mode !== 'remove') {
    console.log('Adding city demo data...');
    await addDemo();
    await addOutreach();
    await applyDeaths();
    console.log('Done. Every record added is tagged as sample data.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
