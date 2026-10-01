// Demo/QA data for visually verifying the Visualizations widget builder --
// real cross-office consolidation (a citizen can be Senior AND Farmer AND
// PWD at once), spread across barangays/sex/age/months so every group-by
// dimension and filter actually shows variation instead of one flat bar.
// Not production data. Idempotent-ish: re-running adds more citizens/
// records rather than erroring, but skips re-creating offices/modules and
// the 10 sample widgets if they already exist (matched by name).
//
// Usage (DATABASE_URL must be the migration-owner superuser connection --
// see docker/secrets/README.md, same as the other scripts/*.ts files):
//   DATABASE_URL=... npx tsx scripts/seedSampleVisualizations.ts
import { prisma } from '../src/lib/prisma';

const ADMIN_USER_ID = 'b5357087-8347-4c0a-b17f-4ccca3d7ce20'; // admin.demo, this dev DB

const FIRST_NAMES_M = [
  'Jose', 'Juan', 'Pedro', 'Antonio', 'Ricardo', 'Roberto', 'Eduardo', 'Fernando', 'Manuel', 'Ramon',
  'Ernesto', 'Danilo', 'Rodrigo', 'Marlon', 'Nestor', 'Bienvenido', 'Rogelio', 'Armando', 'Cesar', 'Leonardo',
];
const FIRST_NAMES_F = [
  'Maria', 'Ana', 'Rosario', 'Carmen', 'Teresa', 'Corazon', 'Luz', 'Elena', 'Gloria', 'Rosa',
  'Herminia', 'Delfin', 'Erlinda', 'Josefina', 'Remedios', 'Cristina', 'Leonora', 'Milagros', 'Perla', 'Angelina',
];
const LAST_NAMES = [
  'Reyes', 'Santos', 'Dela Cruz', 'Garcia', 'Ramos', 'Mendoza', 'Bautista', 'Aquino', 'Domingo', 'Espiritu',
  'Cruz', 'Torres', 'Flores', 'Castillo', 'Navarro', 'Gonzales', 'Pascual', 'Villanueva', 'Marcelo', 'Ferrer',
];

// A representative spread of real Vigan barangays (not all 39 -- keeps bar
// charts readable) -- codes from prisma/seed.ts's BARANGAYS list.
const BARANGAY_CODES = [
  'VIG-001', 'VIG-002', 'VIG-003', 'VIG-004', 'VIG-005', 'VIG-006', 'VIG-007', 'VIG-008', 'VIG-009', 'VIG-010',
  'VIG-018', 'VIG-021', 'VIG-035', 'VIG-038', 'VIG-039',
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// Birthdate for a target current age, with +/- a few months of jitter so
// citizens at "the same age" don't all share one exact age_bracket
// boundary date.
function birthdateForAge(age: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - Math.floor(Math.random() * 300));
  return d;
}

// Spreads records across the last several months so month/trend widgets
// show real variation instead of everything landing on "today".
function dateMonthsAgo(monthsAgo: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(1 + Math.floor(Math.random() * 26));
  return d;
}

async function ensureOffice(name: string, slug: string) {
  const existing = await prisma.office.findUnique({ where: { slug } });
  if (existing) return existing;
  return prisma.office.create({ data: { name, slug, createdBy: ADMIN_USER_ID } });
}

async function ensureModule(
  officeId: string,
  name: string,
  slug: string,
  opts: { requiresCitizenLink?: boolean } = {},
) {
  const existing = await prisma.officeModule.findUnique({ where: { officeId_slug: { officeId, slug } } });
  if (existing) return existing;
  return prisma.officeModule.create({
    data: { officeId, name, slug, requiresCitizenLink: opts.requiresCitizenLink ?? true },
  });
}

type SeededCitizen = { personKey: string; age: number; sex: 'M' | 'F' };

async function createCitizen(age: number, sex: 'M' | 'F', createdAt: Date): Promise<SeededCitizen> {
  const fname = randomFrom(sex === 'M' ? FIRST_NAMES_M : FIRST_NAMES_F);
  const lname = randomFrom(LAST_NAMES);
  const barangayCode = randomFrom(BARANGAY_CODES);
  const civilStatus = age < 18 ? 'Single' : randomFrom(['Single', 'Married', 'Widowed', 'Separated']);
  const citizen = await prisma.citizen.create({
    data: {
      personLname: lname,
      personFname: `${fname}-${Math.random().toString(36).slice(2, 6)}`, // keep names distinct for this demo batch
      personBdate: birthdateForAge(age),
      personSex: sex,
      personCivilStatus: civilStatus,
      personBrgyCode: barangayCode,
      personStreet: `Purok ${1 + Math.floor(Math.random() * 5)}`,
      personOccupation: age >= 18 ? randomFrom(['Farmer', 'Vendor', 'Driver', 'Teacher', 'Laborer', 'None']) : 'None',
      personIsHead: age >= 18 && Math.random() < 0.5,
      createdAt,
      createdBy: ADMIN_USER_ID,
      updatedBy: ADMIN_USER_ID,
    },
    select: { personKey: true },
  });
  return { personKey: citizen.personKey, age, sex };
}

async function addRecord(moduleId: string, personKey: string | null, createdAt: Date) {
  await prisma.officeRecord.create({
    data: { moduleId, personKey, data: {}, createdAt, createdBy: ADMIN_USER_ID, updatedBy: ADMIN_USER_ID },
  });
}

async function main() {
  console.log('Cleaning up leftover "Test Office" clutter from earlier automated test runs...');
  const testOffices = await prisma.office.findMany({ where: { name: 'Test Office' } });
  if (testOffices.length > 0) {
    const officeIds = testOffices.map((o) => o.id);
    await prisma.officeModule.deleteMany({ where: { officeId: { in: officeIds } } });
    await prisma.office.deleteMany({ where: { id: { in: officeIds } } });
    console.log(`Removed ${testOffices.length} leftover test office(s).`);
  }

  console.log('Ensuring CSWD and Civil Registry offices/modules exist...');
  const cswd = await ensureOffice('CSWD', 'cswd');
  const seniorModule = await ensureModule(cswd.id, 'Senior Citizen', 'senior_citizen');
  const pwdModule = await ensureModule(cswd.id, 'PWD', 'pwd');
  const soloParentModule = await ensureModule(cswd.id, 'Solo Parent', 'solo_parent');

  const civilRegistry = await ensureOffice('Civil Registry', 'civil_registry');
  const birthModule = await ensureModule(civilRegistry.id, 'Birth', 'birth', { requiresCitizenLink: false });
  const deathModule = await ensureModule(civilRegistry.id, 'Death', 'death', { requiresCitizenLink: false });

  const farmerModule = await prisma.officeModule.findFirst({ where: { slug: 'farmers' } });
  if (!farmerModule) throw new Error('Expected an existing "Farmers" module (City Agriculture Office) -- not found.');

  console.log('Creating sample citizens across barangays/ages/sexes...');

  // Seniors (60-89) -- some later also get Farmer/PWD records for real
  // cross-office overlap, which is the whole point of this consolidation
  // demo.
  const seniors: SeededCitizen[] = [];
  for (let i = 0; i < 18; i++) {
    const age = 60 + Math.floor(Math.random() * 30);
    const sex = Math.random() < 0.5 ? 'M' : 'F';
    const createdAt = dateMonthsAgo(Math.floor(Math.random() * 6));
    const c = await createCitizen(age, sex, createdAt);
    seniors.push(c);
    await addRecord(seniorModule.id, c.personKey, createdAt);
  }

  // Working-age adults (18-59) -- the Farmer/PWD/Solo Parent pool.
  const adults: SeededCitizen[] = [];
  for (let i = 0; i < 40; i++) {
    const age = 18 + Math.floor(Math.random() * 42);
    const sex = Math.random() < 0.5 ? 'M' : 'F';
    const createdAt = dateMonthsAgo(Math.floor(Math.random() * 6));
    const c = await createCitizen(age, sex, createdAt);
    adults.push(c);
  }

  // Minors -- the Birth-registration pool (mostly infants/toddlers).
  const minors: SeededCitizen[] = [];
  for (let i = 0; i < 12; i++) {
    const age = Math.floor(Math.random() * 5);
    const sex = Math.random() < 0.5 ? 'M' : 'F';
    const createdAt = dateMonthsAgo(Math.floor(Math.random() * 6));
    const c = await createCitizen(age, sex, createdAt);
    minors.push(c);
  }

  console.log('Assigning office records (with deliberate cross-office overlap)...');

  // Farmers: 20 adults, including 5 of the seniors above (Senior+Farmer
  // overlap) and 2 more added later for PWD+Farmer overlap.
  const farmerPeople = [...adults.slice(0, 15), ...seniors.slice(0, 5)];
  for (const p of farmerPeople) {
    await addRecord(farmerModule.id, p.personKey, dateMonthsAgo(Math.floor(Math.random() * 6)));
  }

  // PWD: 10 people -- 3 seniors (Senior+PWD overlap), 2 farmers
  // (Farmer+PWD overlap), 5 other adults.
  const pwdPeople = [...seniors.slice(5, 8), ...adults.slice(15, 17), ...adults.slice(17, 22)];
  for (const p of pwdPeople) {
    await addRecord(pwdModule.id, p.personKey, dateMonthsAgo(Math.floor(Math.random() * 6)));
  }

  // Solo Parent: 8 adults, 2 of whom are also Farmers (overlap).
  const soloParentPeople = [...adults.slice(15, 17), ...adults.slice(22, 28)];
  for (const p of soloParentPeople) {
    await addRecord(soloParentModule.id, p.personKey, dateMonthsAgo(Math.floor(Math.random() * 6)));
  }

  // Birth: register 12 of the seeded minors.
  for (const p of minors) {
    await addRecord(birthModule.id, p.personKey, dateMonthsAgo(Math.floor(Math.random() * 6)));
  }

  // Death: 5 of the oldest seniors.
  for (const p of seniors.slice(13, 18)) {
    await addRecord(deathModule.id, p.personKey, dateMonthsAgo(Math.floor(Math.random() * 6)));
  }

  console.log('Creating 10 sample visualizations...');

  async function createWidget(
    title: string,
    sourceModuleIds: string[],
    chartType: 'bar' | 'line' | 'number',
    groupBy: string[] = [],
    filters: { filterBarangayCode?: string; filterSex?: string; filterMonth?: string } = {},
  ) {
    const existing = await prisma.dashboardWidget.findFirst({ where: { title } });
    if (existing) {
      console.log(`  (already exists) ${title}`);
      return;
    }
    const maxSort = await prisma.dashboardWidget.aggregate({ _max: { sortOrder: true } });
    await prisma.dashboardWidget.create({
      data: {
        title,
        chartType,
        groupBy,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        createdBy: ADMIN_USER_ID,
        ...filters,
        sources: { create: sourceModuleIds.map((moduleId) => ({ moduleId })) },
      },
    });
    console.log(`  created: ${title}`);
  }

  await createWidget(
    'Citizens by Barangay — Senior vs Farmer vs PWD',
    [seniorModule.id, farmerModule.id, pwdModule.id],
    'bar',
    ['barangay'],
  );
  await createWidget(
    'Program Enrollment by Sex — All CSWD + Farmer',
    [seniorModule.id, pwdModule.id, soloParentModule.id, farmerModule.id],
    'bar',
    ['sex'],
  );
  await createWidget(
    'Age Distribution Across CSWD Programs',
    [seniorModule.id, pwdModule.id, soloParentModule.id],
    'bar',
    ['age_bracket'],
  );
  await createWidget(
    'Monthly Registrations — Civil Registry vs Social Programs',
    [birthModule.id, seniorModule.id, farmerModule.id],
    'line',
    ['month'],
  );
  await createWidget(
    'Total Beneficiaries per Program (All Offices)',
    [seniorModule.id, pwdModule.id, soloParentModule.id, farmerModule.id, birthModule.id, deathModule.id],
    'number',
  );
  await createWidget(
    'Male Farmers & Seniors by Age Group',
    [farmerModule.id, seniorModule.id],
    'bar',
    ['age_bracket'],
    { filterSex: 'M' },
  );
  await createWidget('PWD and Solo Parent by Barangay', [pwdModule.id, soloParentModule.id], 'bar', ['barangay']);
  await createWidget('Civil Registry Trend — Births vs Deaths by Month', [birthModule.id, deathModule.id], 'line', ['month']);
  const filterBarangay = await prisma.barangay.findUnique({ where: { code: BARANGAY_CODES[0] } });
  await createWidget(
    `Senior Citizens in ${filterBarangay?.name ?? BARANGAY_CODES[0]} by Sex`,
    [seniorModule.id],
    'bar',
    ['sex'],
    { filterBarangayCode: BARANGAY_CODES[0] },
  );
  await createWidget(
    'Cross-Office Overlap Snapshot — Every Program by Barangay',
    [seniorModule.id, pwdModule.id, soloParentModule.id, farmerModule.id, birthModule.id, deathModule.id],
    'bar',
    ['barangay'],
  );

  const citizenCount = await prisma.citizen.count();
  console.log(`\nDone. ${citizenCount} citizens on file, 10 sample visualizations created (or already present).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
