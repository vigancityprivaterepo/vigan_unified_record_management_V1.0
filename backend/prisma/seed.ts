import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Dev/test login only -- same password for every demo account, never used
// beyond a local dev DB. Real deployments create staff accounts through the
// admin-only Settings page (routes/adminUsers.ts) or scripts/
// manageStaffAccount.ts, both of which generate a unique, properly-random
// password per account.
const DEV_PASSWORD = 'dev-password-not-for-prod';

// Dev/test fixture data only -- never production citizen data.
//
// Barangay codes below are placeholders (VIG-xxx), not verified official
// PSGC codes -- swap for an authoritative PSGC barangay import before this
// touches anything beyond a local dev DB. Names are the full 39 barangays
// of Vigan City, Ilocos Sur (cross-checked against Wikipedia and PhilAtlas
// -- both agree on the same 39 names). The first 10 (VIG-001..010) keep
// their original codes since fixture citizens below key off them by code;
// VIG-011..039 were appended later and are otherwise unordered.
const BARANGAYS = [
  { code: 'VIG-001', name: 'Barangay I (Poblacion)' },
  { code: 'VIG-002', name: 'Barangay II (Poblacion)' },
  { code: 'VIG-003', name: 'Ayusan Norte' },
  { code: 'VIG-004', name: 'Ayusan Sur' },
  { code: 'VIG-005', name: 'Bulala' },
  { code: 'VIG-006', name: 'Camangaan' },
  { code: 'VIG-007', name: 'Mindoro' },
  { code: 'VIG-008', name: 'Paoa' },
  { code: 'VIG-009', name: 'Pantay Daya' },
  { code: 'VIG-010', name: 'Rugsuanan' },
  { code: 'VIG-011', name: 'Barangay III (Poblacion)' },
  { code: 'VIG-012', name: 'Barangay IV (Poblacion)' },
  { code: 'VIG-013', name: 'Barangay V (Poblacion)' },
  { code: 'VIG-014', name: 'Barangay VI (Poblacion)' },
  { code: 'VIG-015', name: 'Barangay VII (Poblacion)' },
  { code: 'VIG-016', name: 'Barangay VIII (Poblacion)' },
  { code: 'VIG-017', name: 'Barangay IX (Poblacion)' },
  { code: 'VIG-018', name: 'Barraca' },
  { code: 'VIG-019', name: 'Beddeng Daya' },
  { code: 'VIG-020', name: 'Beddeng Laud' },
  { code: 'VIG-021', name: 'Bongtolan' },
  { code: 'VIG-022', name: 'Cabalangegan' },
  { code: 'VIG-023', name: 'Cabaroan Daya' },
  { code: 'VIG-024', name: 'Cabaroan Laud' },
  { code: 'VIG-025', name: 'Capangpangan' },
  { code: 'VIG-026', name: 'Nagsangalan' },
  { code: 'VIG-027', name: 'Pantay Fatima' },
  { code: 'VIG-028', name: 'Pantay Laud' },
  { code: 'VIG-029', name: 'Paratong' },
  { code: 'VIG-030', name: 'Pong-ol' },
  { code: 'VIG-031', name: 'Purok-a-bassit' },
  { code: 'VIG-032', name: 'Purok-a-dackel' },
  { code: 'VIG-033', name: 'Raois' },
  { code: 'VIG-034', name: 'Salindeg' },
  { code: 'VIG-035', name: 'San Jose' },
  { code: 'VIG-036', name: 'San Julian Norte' },
  { code: 'VIG-037', name: 'San Julian Sur' },
  { code: 'VIG-038', name: 'San Pedro' },
  { code: 'VIG-039', name: 'Tamag' },
];

async function main() {
  await prisma.staffAccount.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.duplicateReviewQueueItem.deleteMany();
  await prisma.dashboardWidget.deleteMany();
  await prisma.officeRecord.deleteMany();
  await prisma.programGapRule.deleteMany();
  await prisma.officeFormField.deleteMany();
  await prisma.officeModule.deleteMany();
  await prisma.office.deleteMany();
  await prisma.citizen.deleteMany();
  await prisma.barangay.deleteMany();

  for (const b of BARANGAYS) {
    await prisma.barangay.create({ data: b });
  }

  // --- Offices + modules ---------------------------------------------------
  // Every office (CSWD/Agriculture/Civil Registry included) is just an
  // Office row with one or more OfficeModule children -- there's no more
  // hardcoded per-office schema, so seeding "the CSWD form" means declaring
  // its modules and their fields like any admin-created office would.
  const adminUserPlaceholder = '00000000-0000-0000-0000-000000000000';

  const cswdOffice = await prisma.office.create({
    data: { name: 'City Social Welfare and Development Office', slug: 'cswd', createdBy: adminUserPlaceholder },
  });
  const seniorModule = await prisma.officeModule.create({
    data: { officeId: cswdOffice.id, name: 'Senior Citizen', slug: 'senior', requiresCitizenLink: true, sortOrder: 0 },
  });
  const pwdModule = await prisma.officeModule.create({
    data: { officeId: cswdOffice.id, name: 'PWD', slug: 'pwd', requiresCitizenLink: true, sortOrder: 1 },
  });
  const soloParentModule = await prisma.officeModule.create({
    data: { officeId: cswdOffice.id, name: 'Solo Parent', slug: 'solo_parent', requiresCitizenLink: true, sortOrder: 2 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: seniorModule.id, key: 'has_id', label: 'Has Senior Citizen ID', fieldType: 'BOOLEAN', sortOrder: 0 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: pwdModule.id, key: 'type_of_disability', label: 'Type of Disability', fieldType: 'TEXT', sortOrder: 0 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: pwdModule.id, key: 'has_id', label: 'Has PWD ID', fieldType: 'BOOLEAN', sortOrder: 1 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: soloParentModule.id, key: 'number_of_children', label: 'Number of Children', fieldType: 'NUMBER', sortOrder: 0 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: soloParentModule.id, key: 'has_id', label: 'Has Solo Parent ID', fieldType: 'BOOLEAN', sortOrder: 1 },
  });

  const agricultureOffice = await prisma.office.create({
    data: { name: 'City Agriculture Office', slug: 'agriculture', createdBy: adminUserPlaceholder },
  });
  const farmerModule = await prisma.officeModule.create({
    data: { officeId: agricultureOffice.id, name: 'Farmer', slug: 'farmer', requiresCitizenLink: true, sortOrder: 0 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: farmerModule.id, key: 'location_of_farm', label: 'Location of Farm', fieldType: 'TEXT', sortOrder: 0 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: farmerModule.id, key: 'size_of_farm', label: 'Size of Farm (ha)', fieldType: 'NUMBER', sortOrder: 1 },
  });

  const civilRegistryOffice = await prisma.office.create({
    data: { name: 'City Civil Registry Office', slug: 'civil_registry', createdBy: adminUserPlaceholder },
  });
  // Birth allows recording a birth with no Citizen link yet (e.g. still
  // pending resolvePerson() resolution) -- mirrors the old nullable
  // Person_Birth.person_key.
  const birthModule = await prisma.officeModule.create({
    data: { officeId: civilRegistryOffice.id, name: 'Birth', slug: 'birth', requiresCitizenLink: false, sortOrder: 0 },
  });
  const deathModule = await prisma.officeModule.create({
    data: { officeId: civilRegistryOffice.id, name: 'Death', slug: 'death', requiresCitizenLink: true, sortOrder: 1 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: birthModule.id, key: 'birth_place', label: 'Place of Birth', fieldType: 'TEXT', sortOrder: 0 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: birthModule.id, key: 'mother', label: 'Mother', fieldType: 'TEXT', sortOrder: 1 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: birthModule.id, key: 'father', label: 'Father', fieldType: 'TEXT', sortOrder: 2 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: deathModule.id, key: 'place_of_death', label: 'Place of Death', fieldType: 'TEXT', sortOrder: 0 },
  });
  await prisma.officeFormField.create({
    data: { moduleId: deathModule.id, key: 'cause_of_death', label: 'Cause of Death', fieldType: 'TEXT', sortOrder: 1 },
  });

  // --- Staff accounts --------------------------------------------------------
  // Demo usernames kept stable across the offices-as-modules migration --
  // only the role/officeId under the hood changed (cswd_staff -> office_staff
  // scoped to the CSWD office, etc.) -- so existing dev muscle memory and
  // test fixtures referencing these usernames still work.
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  const STAFF_ACCOUNTS = [
    { username: 'cswd.demo', fullName: 'CSWD Demo Staff', role: 'office_staff' as const, officeId: cswdOffice.id },
    { username: 'agri.demo', fullName: 'Agriculture Demo Staff', role: 'office_staff' as const, officeId: agricultureOffice.id },
    { username: 'civilreg.demo', fullName: 'Civil Registry Demo Staff', role: 'office_staff' as const, officeId: civilRegistryOffice.id },
    { username: 'admin.demo', fullName: 'Admin Demo', role: 'admin' as const, officeId: null },
  ];
  for (const account of STAFF_ACCOUNTS) {
    await prisma.staffAccount.create({ data: { ...account, passwordHash } });
  }

  // --- Household 1: Reyes family (Barangay I) --------------------------
  const reyesHead = await prisma.citizen.create({
    data: {
      personLname: 'Reyes', personFname: 'Juan', personMname: 'Santos',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1962-03-14'),
      personCivilStatus: 'Married', personIsHead: true, personRelationToHead: 'Head',
      personStreet: 'Rizal St.', personBrgyCode: 'VIG-001',
      personOccupation: 'Tricycle Driver',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Reyes', personFname: 'Maria', personMname: 'Cruz',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1965-07-22'),
      personCivilStatus: 'Married', personRelationToHead: 'Spouse',
      personParentKey: reyesHead.personKey,
      personStreet: 'Rizal St.', personBrgyCode: 'VIG-001',
      personOccupation: 'Vendor',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Reyes', personFname: 'Ana', personMname: 'Cruz',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1990-01-10'),
      personCivilStatus: 'Single', personRelationToHead: 'Daughter',
      personParentKey: reyesHead.personKey,
      personStreet: 'Rizal St.', personBrgyCode: 'VIG-001',
      personEducLevel: 'College', personEducCourse: 'BS Education',
      personOccupation: 'Teacher',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Reyes', personFname: 'Mark', personMname: 'Cruz',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1993-05-18'),
      personCivilStatus: 'Single', personRelationToHead: 'Son',
      personParentKey: reyesHead.personKey,
      personStreet: 'Rizal St.', personBrgyCode: 'VIG-001',
    },
  });

  // --- Household 2: Dela Cruz family (Bulala) -- nested sub-household --
  const delaCruzHead = await prisma.citizen.create({
    data: {
      personLname: 'Dela Cruz', personFname: 'Pedro', personMname: 'Garcia',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1958-11-02'),
      personCivilStatus: 'Married', personIsHead: true, personRelationToHead: 'Head',
      personStreet: 'Purok 3', personBrgyCode: 'VIG-005',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Dela Cruz', personFname: 'Josefa', personMname: 'Garcia',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1960-02-17'),
      personCivilStatus: 'Married', personRelationToHead: 'Spouse',
      personParentKey: delaCruzHead.personKey,
      personStreet: 'Purok 3', personBrgyCode: 'VIG-005',
    },
  });
  const delaCruzSon = await prisma.citizen.create({
    data: {
      personLname: 'Dela Cruz', personFname: 'Ricardo', personMname: 'Garcia',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1985-09-09'),
      personCivilStatus: 'Married', personRelationToHead: 'Son',
      personParentKey: delaCruzHead.personKey,
      personStreet: 'Purok 3', personBrgyCode: 'VIG-005',
      personOccupation: 'Farmer',
    },
  });
  // Grandchild: same household (parent_key = grandparent/head), nested
  // under the immediate parent via sub_parent_key.
  const delaCruzGrandchild = await prisma.citizen.create({
    data: {
      personLname: 'Dela Cruz', personFname: 'Miguel', personMname: 'Garcia',
      personSex: 'M', personGender: 'Male', personBdate: new Date('2015-04-01'),
      personCivilStatus: 'Single', personRelationToHead: 'Grandchild',
      personParentKey: delaCruzHead.personKey,
      personSubParentKey: delaCruzSon.personKey,
      personStreet: 'Purok 3', personBrgyCode: 'VIG-005',
    },
  });

  // --- Household 3: Bautista family (Camangaan) -- PWD + Solo Parent ---
  const bautistaHead = await prisma.citizen.create({
    data: {
      personLname: 'Bautista', personFname: 'Antonio', personMname: 'Ramos',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1970-06-30'),
      personCivilStatus: 'Married', personIsHead: true, personRelationToHead: 'Head',
      personStreet: 'Purok 1', personBrgyCode: 'VIG-006',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Bautista', personFname: 'Teresita', personMname: 'Ramos',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1972-08-08'),
      personCivilStatus: 'Married', personRelationToHead: 'Spouse',
      personParentKey: bautistaHead.personKey,
      personStreet: 'Purok 1', personBrgyCode: 'VIG-006',
    },
  });
  const bautistaDaughter = await prisma.citizen.create({
    data: {
      personLname: 'Bautista', personFname: 'Liza', personMname: 'Ramos',
      personSex: 'F', personGender: 'Female', personBdate: new Date('2001-12-25'),
      personCivilStatus: 'Single', personRelationToHead: 'Daughter',
      personParentKey: bautistaHead.personKey,
      personStreet: 'Purok 1', personBrgyCode: 'VIG-006',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Bautista', personFname: 'Nico', personMname: 'Ramos',
      personSex: 'M', personGender: 'Male', personBdate: new Date('2020-03-03'),
      personCivilStatus: 'Single', personRelationToHead: 'Grandchild',
      personParentKey: bautistaHead.personKey,
      personSubParentKey: bautistaDaughter.personKey,
      personStreet: 'Purok 1', personBrgyCode: 'VIG-006',
    },
  });

  // --- Household 4: Domingo family (Paoa) -- Senior + Farmer -----------
  const domingoHead = await prisma.citizen.create({
    data: {
      personLname: 'Domingo', personFname: 'Ramon', personMname: 'Tolentino',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1955-01-01'),
      personCivilStatus: 'Married', personIsHead: true, personRelationToHead: 'Head',
      personStreet: 'Sitio Nangalisan', personBrgyCode: 'VIG-008',
      personOccupation: 'Farmer',
    },
  });
  const domingoSpouse = await prisma.citizen.create({
    data: {
      personLname: 'Domingo', personFname: 'Corazon', personMname: 'Tolentino',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1957-04-04'),
      personCivilStatus: 'Married', personRelationToHead: 'Spouse',
      personParentKey: domingoHead.personKey,
      personStreet: 'Sitio Nangalisan', personBrgyCode: 'VIG-008',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Domingo', personFname: 'Elena', personMname: 'Tolentino',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1980-10-10'),
      personCivilStatus: 'Married', personRelationToHead: 'Daughter',
      personParentKey: domingoHead.personKey,
      personStreet: 'Sitio Nangalisan', personBrgyCode: 'VIG-008',
      personOccupation: 'Farmer',
    },
  });

  // --- Household 5: Villanueva family (Rugsuanan) -- has a death record
  const villanuevaHead = await prisma.citizen.create({
    data: {
      personLname: 'Villanueva', personFname: 'Manuel', personMname: 'Abaya',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1945-05-05'),
      personCivilStatus: 'Widowed', personIsHead: true, personRelationToHead: 'Head',
      personStreet: 'Purok 2', personBrgyCode: 'VIG-010',
    },
  });
  const villanuevaSpouse = await prisma.citizen.create({
    data: {
      personLname: 'Villanueva', personFname: 'Lourdes', personMname: 'Abaya',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1948-09-09'),
      personCivilStatus: 'Widowed', personRelationToHead: 'Spouse',
      personParentKey: villanuevaHead.personKey,
      personStreet: 'Purok 2', personBrgyCode: 'VIG-010',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Villanueva', personFname: 'Rosario', personMname: 'Abaya',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1975-03-03'),
      personCivilStatus: 'Married', personRelationToHead: 'Daughter',
      personParentKey: villanuevaHead.personKey,
      personStreet: 'Purok 2', personBrgyCode: 'VIG-010',
    },
  });

  // --- Extra standalone citizens: same surname, different families -----
  // Deliberately shares "Santos" surname with no relation, in a different
  // barangay from any Santos above -- exercises pg_trgm surname density
  // (Phase 2) without seeding an actual unresolved duplicate.
  const santosA = await prisma.citizen.create({
    data: {
      personLname: 'Santos', personFname: 'Eduardo', personMname: 'Ferrer',
      personSex: 'M', personGender: 'Male', personBdate: new Date('1968-02-20'),
      personCivilStatus: 'Married', personIsHead: true, personRelationToHead: 'Head',
      personBrgyCode: 'VIG-002', personOccupation: 'Farmer',
    },
  });
  await prisma.citizen.create({
    data: {
      personLname: 'Santos', personFname: 'Ederlina', personMname: 'Valdez',
      personSex: 'F', personGender: 'Female', personBdate: new Date('1971-06-15'),
      personCivilStatus: 'Married', personIsHead: true, personRelationToHead: 'Head',
      personBrgyCode: 'VIG-003',
    },
  });

  // --- Office records -------------------------------------------------------
  await prisma.officeRecord.create({
    data: { moduleId: seniorModule.id, personKey: domingoHead.personKey, data: { has_id: true }, createdBy: adminUserPlaceholder, updatedBy: adminUserPlaceholder },
  });
  await prisma.officeRecord.create({
    data: { moduleId: seniorModule.id, personKey: domingoSpouse.personKey, data: { has_id: false }, createdBy: adminUserPlaceholder, updatedBy: adminUserPlaceholder },
  });
  await prisma.officeRecord.create({
    data: { moduleId: seniorModule.id, personKey: villanuevaSpouse.personKey, data: { has_id: true }, createdBy: adminUserPlaceholder, updatedBy: adminUserPlaceholder },
  });

  await prisma.officeRecord.create({
    data: {
      moduleId: pwdModule.id,
      personKey: bautistaHead.personKey,
      data: { type_of_disability: 'Visual Impairment', has_id: true },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });

  await prisma.officeRecord.create({
    data: {
      moduleId: soloParentModule.id,
      personKey: bautistaDaughter.personKey,
      data: { number_of_children: 1, has_id: false },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });

  await prisma.officeRecord.create({
    data: {
      moduleId: farmerModule.id,
      personKey: delaCruzSon.personKey,
      data: { location_of_farm: 'Bulala, Vigan City', size_of_farm: 1.5 },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });
  await prisma.officeRecord.create({
    data: {
      moduleId: farmerModule.id,
      personKey: domingoHead.personKey,
      data: { location_of_farm: 'Paoa, Vigan City', size_of_farm: 2.25 },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });
  await prisma.officeRecord.create({
    data: {
      moduleId: farmerModule.id,
      personKey: domingoSpouse.personKey,
      data: { location_of_farm: 'Paoa, Vigan City', size_of_farm: 2.25 },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });
  await prisma.officeRecord.create({
    data: {
      moduleId: farmerModule.id,
      personKey: santosA.personKey,
      data: { location_of_farm: 'Barangay II, Vigan City', size_of_farm: 0.8 },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });

  // Resolved birth record (linked to an already-seeded citizen).
  await prisma.officeRecord.create({
    data: {
      moduleId: birthModule.id,
      personKey: delaCruzGrandchild.personKey,
      data: { birth_place: 'Vigan City', mother: 'Ana Garcia', father: 'Ricardo Dela Cruz' },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });
  // Unresolved birth record -- no Citizen link yet, pending resolvePerson()
  // linkage (Phase 2/6), same as the old nullable Person_Birth.person_key.
  await prisma.officeRecord.create({
    data: {
      moduleId: birthModule.id,
      personKey: null,
      unresolvedPerson: { lname: 'Corpuz', fname: 'Ella', mname: 'Manalo', bdate: '2024-11-02' },
      data: { birth_place: 'Vigan City', mother: 'Marites Manalo', father: 'Jerome Corpuz' },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });

  await prisma.officeRecord.create({
    data: {
      moduleId: deathModule.id,
      personKey: villanuevaHead.personKey,
      data: { place_of_death: 'Vigan City', cause_of_death: 'Natural causes' },
      createdBy: adminUserPlaceholder,
      updatedBy: adminUserPlaceholder,
    },
  });

  const citizenCount = await prisma.citizen.count();
  const householdHeadCount = await prisma.citizen.count({ where: { personIsHead: true } });
  console.log(`Seeded ${citizenCount} citizens across ${householdHeadCount} households, ${BARANGAYS.length} barangays.`);
  console.log(`Also seeded 3 offices (CSWD, Agriculture, Civil Registry) with 6 modules and their office_record fixtures.`);
  console.log(`Note for Phase 2 fuzzy-match testing: surname "Santos" appears twice (Eduardo/VIG-002, Ederlina/VIG-003) for unrelated people -- resolvePerson() must NOT merge on surname alone.`);
  console.log(`Seeded 4 demo staff accounts (admin.demo, cswd.demo, agri.demo, civilreg.demo), password "${DEV_PASSWORD}" for all -- dev/test only.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
