import { registerShortNames } from '@/lib/shortNames';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  code: string;
  details: unknown;
  status: number;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Every backend error responds with { error: { code, message, details } }
// (Phase 0 convention) -- this unwraps that shape into a typed ApiError so
// callers can just try/catch instead of checking res.ok everywhere.
// CSV exports: fetched with the session cookie, then handed to the browser
// as a download under the filename the backend chose.
// Opens an uploaded document (PDF/image) in a new tab. The tab is opened
// before the fetch so popup blockers treat it as a click, then pointed at
// the downloaded file.
async function openInNewTab(path: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const err = body?.error ?? { code: 'UNKNOWN_ERROR', message: `Could not open the document (status ${res.status})` };
      throw new ApiError(res.status, err.code, err.message, err.details);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error ?? { code: 'UNKNOWN_ERROR', message: `Export failed with status ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string; details?: unknown } })?.error ?? {
      code: 'UNKNOWN_ERROR',
      message: `Request failed with status ${res.status}`,
    };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }

  return body as T;
}

// Skips undefined/empty values -- an unset filter shouldn't send `?from=`.
function queryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '');
  if (entries.length === 0) return '';
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

// Shared shape for every paginated list endpoint (office records, citizens,
// households) -- one fixed page size per list, set server-side.
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// Every office -- CSWD/Agriculture/Civil Registry included, as of the
// offices-as-modules unification -- shares the one office_staff role.
export type StaffRole = 'admin' | 'office_staff';

export type Session = { userId: string; username: string; fullName?: string; position?: string | null; role: StaffRole; officeId?: string };

export type FuzzyCandidate = {
  personKey: string;
  personLname: string;
  personFname: string;
  personBdate: string | null;
  similarity: number;
};

// Every module's intake endpoint returns one of these. `householdLinkWarning`
// only ever appears on the 'created'/'matched' variant -- household linking
// needs a resolved personKey, so it's the only branch that attempts it (see
// office.ts's intake route). Its presence means the record itself still
// saved fine; only the optional household link didn't go through.
export type IntakeResult =
  | { status: 'created' | 'matched'; personKey: string; recordId: string; householdLinkWarning?: string }
  | { status: 'needs_review'; candidates: FuzzyCandidate[] }
  // A module with requiresCitizenLink=false (or linkToCitizen=false on a
  // submission to one that allows it) records with no Citizen link at all.
  | { status: 'recorded_no_citizen_link'; recordId: string }
  // A module with collectPersonInfo=false isn't about a person at all
  // (e.g. an Assessor's Office "Lots" module) -- no name was even
  // collected, so there's no Citizen link question to begin with.
  | { status: 'recorded'; recordId: string };

export type PersonCore = {
  lname: string;
  fname: string;
  mname?: string;
  bdate: string;
  sex?: string;
  civilStatus?: string;
  street?: string;
  brgyCode?: string;
};

export type ReviewQueueItem = {
  id: string;
  moduleId: string;
  moduleName: string | null;
  officeName: string | null;
  candidateData: {
    lname: string;
    fname: string;
    mname?: string;
    bdate: string;
    fields?: Record<string, unknown>;
    [key: string]: unknown;
  };
  fuzzyMatches: FuzzyCandidate[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};

export type CitizenListItem = {
  personKey: string;
  personLname: string;
  personFname: string;
  personMname: string | null;
  personBdate: string | null;
  personIsHead: boolean;
  isArchived: boolean;
  barangay: { name: string } | null;
  // Only on admin's /admin/citizens list -- offices holding records for them.
  offices?: Array<{ id: string; name: string; accentHue: number; icon?: string }>;
};

export type Citizen360 = {
  citizen: {
    personKey: string;
    personParentKey: string | null;
    personSubParentKey: string | null;
    personIsHead: boolean;
    personRelationToHead: string | null;
    personLname: string;
    personFname: string;
    personMname: string | null;
    personStreet: string | null;
    personSex: string | null;
    personGender: string | null;
    personBdate: string | null;
    personCivilStatus: string | null;
    personReligion: string | null;
    personEducLevel: string | null;
    personEducCourse: string | null;
    personOccupation: string | null;
    personOccupationIndustry: string | null;
    personOccupationBusName: string | null;
    personOccupationBusAddress: string | null;
    createdAt: string;
    updatedAt: string;
    isArchived: boolean;
    barangay: { code: string; name: string } | null;
    parent: { personKey: string; personLname: string; personFname: string } | null;
    // Decrypted server-side (admin-only route) -- see backend/src/lib/encryption.ts.
    sss: string | null;
    gsis: string | null;
    philhealth: string | null;
  };
  officeRecords: Array<{
    id: string;
    data: Record<string, unknown>;
    createdAt: string;
    module: {
      id: string;
      name: string;
      slug: string;
      office: { id: string; name: string; slug: string; accentHue: number; icon: string };
      formFields: Array<{ key: string; label: string; fieldType: OfficeFieldType }>;
    };
  }>;
  // Everyone in this person's household (head first), empty if none.
  household: Array<{
    personKey: string;
    personLname: string;
    personFname: string;
    personMname: string | null;
    personIsHead: boolean;
    personRelationToHead: string | null;
  }>;
};

export type HouseholdListItem = {
  personKey: string;
  personLname: string;
  personFname: string;
  barangayName: string | null;
  memberCount: number;
  // Members matching the search (empty without one).
  matchedMembers?: string[];
};

export type PersonCategory = { moduleId: string; moduleName: string; officeId: string; officeName: string; accentHue: number };

export type HouseholdMember = {
  personKey: string;
  personLname: string;
  personFname: string;
  personMname: string | null;
  personBdate: string | null;
  personRelationToHead: string | null;
  personSubParentKey: string | null;
  categories: PersonCategory[];
};

export type HouseholdDetail = {
  head: HouseholdMember & { barangayName: string | null };
  members: HouseholdMember[];
};

export type DashboardSummary = {
  citizenCount: number;
  officeCount: number;
  moduleCount: number;
  recordsThisMonth: number;
};

// --- Admin: Insights dashboard -----------------------------------------------
// Overview -> pattern -> detail: a headline KPI row, relationship charts
// (category-overlap Sankey, barangay ranking, registration/merge trend),
// and a drill-down list -- all sharing one filter shape (barangayCode +
// a month range, plus a Sankey bucket for the drill-down). See
// backend/src/services/insights.ts for how each is computed.
export type InsightsFilters = { barangayCode?: string; from?: string; to?: string };

export type InsightsSummary = {
  totalCitizens: number;
  totalHouseholds: number;
  overlapCount: number;
  completenessPct: number;
};

export type SankeyModule = { id: string; name: string; slug: string };
export type SankeyBucket = { moduleIds: string[]; label: string; count: number };
export type SankeyData = { modules: SankeyModule[]; buckets: SankeyBucket[] };

export type BarangayRankingRow = { code: string; name: string; count: number };

export type TrendPoint = { month: string; registrations: number; merges: number };

export type InsightsCitizenRow = {
  personKey: string;
  personLname: string;
  personFname: string;
  barangayName: string | null;
  personIsHead: boolean;
  personParentKey: string | null;
};

export type StaffAccount = {
  id: string;
  username: string;
  fullName: string;
  // Job title, e.g. "Social Welfare Aide".
  position?: string | null;
  role: StaffRole;
  officeId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // From the login audit trail; null if never signed in.
  lastSignInAt?: string | null;
};

export type AppSettings = {
  FUZZY_MATCH_THRESHOLD: string;
  FUZZY_MATCH_BDATE_TOLERANCE_DAYS: string;
};

// --- Offices, modules, form fields -------------------------------------------
// Every office -- CSWD/Agriculture/Civil Registry included -- is just an
// Office row with one or more OfficeModule children. See
// backend/prisma/schema.prisma's comment above the Office model.

export type Office = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt?: string;
  accentHue?: number;
  icon?: string;
  // Admin-set acronym (CENRO, BPLO...); null/undefined = derived from name.
  shortName?: string | null;
  // Only on admin's office list -- active records across all its modules,
  // this month's, active staff accounts, and the office's modules.
  recordCount?: number;
  recordsThisMonth?: number;
  activeStaffCount?: number;
  modules?: Array<{ id: string; name: string }>;
};

export type OfficeBreakdown = {
  offices: Array<{ id: string; name: string; shortName?: string | null; slug: string; accentHue: number; icon: string }>;
  moduleOffice: Record<string, string>;
  months: Array<{ month: string; counts: Record<string, number> }>;
  barangays: Array<{ code: string; name: string; total: number; counts: Record<string, number> }>;
  coverage: Array<{ code: string; name: string; citizens: number; records: number; offices: number }>;
};

export type OfficeModule = {
  id: string;
  officeId: string;
  name: string;
  slug: string;
  // Whether a submission must resolve to a Citizen, or may stand alone
  // (e.g. a Birth module recording a family that doesn't reside in Vigan).
  requiresCitizenLink: boolean;
  sortOrder: number;
  // Last/first/middle name + birthdate are collected only when
  // collectPersonInfo is true -- these four then gate the rest of that
  // same core block (see PersonCoreFields.tsx). collectPersonInfo false
  // means this module isn't about a person at all (e.g. an Assessor's
  // Office "Lots" module) -- forces requiresCitizenLink false too.
  collectSex: boolean;
  collectCivilStatus: boolean;
  collectStreet: boolean;
  collectBarangay: boolean;
  collectPersonInfo: boolean;
};

export type OfficeFieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SELECT'
  | 'FILE'
  | 'MULTISELECT'
  | 'TEXTAREA'
  | 'EMAIL'
  | 'PHONE'
  | 'TIME';

export type OfficeFormField = {
  id: string;
  moduleId: string;
  key: string;
  label: string;
  fieldType: OfficeFieldType;
  options: string[];
  isRequired: boolean;
  sortOrder: number;
};

export type OfficeIntakeFieldValues = Record<string, string | number | boolean | string[] | undefined>;

// See backend services/officeRecordList.ts for how each is derived.
export type RecordStatus = 'linked' | 'new' | 'unlinked' | 'review';

export type OfficeRecordList = Paginated<OfficeRecordListItem> & {
  counts: Record<RecordStatus | 'all' | 'archived', number>;
  addedThisMonth: number;
};

export type OfficeRecordListItem = {
  id: string;
  status: RecordStatus;
  data: Record<string, unknown>;
  unresolvedPerson: { lname: string; fname: string; mname?: string; bdate: string } | null;
  createdAt: string;
  citizen: {
    personLname: string;
    personFname: string;
    personMname: string | null;
    personBdate: string | null;
    barangay: { name: string } | null;
  } | null;
};

// --- Admin custom dashboard visualizations ----------------------------------
// See backend/prisma/schema.prisma's DashboardWidget comment: a fixed
// "recipe" (one or more source modules + optional group-by + chart type),
// not an open-ended query builder. A widget with more than one source
// module consolidates them onto one chart -- one series per module,
// sharing the same group-by axis.
export type WidgetChartType = 'bar' | 'line' | 'donut' | 'number';

// Shared by create (POST) and edit (PATCH) -- same recipe shape either way,
// the edit form always submits the complete state rather than a partial diff.
export type DashboardWidgetPayload = {
  title: string;
  sourceModuleIds: string[];
  groupBy?: string[];
  chartType: WidgetChartType;
  // 'count' (records) or 'sum:<fieldKey>' (total of a NUMBER field).
  measure?: string;
  filterBarangayCode?: string;
  filterSex?: string;
  filterMonth?: string;
  filterFieldKey?: string;
  filterFieldValue?: string;
};

export type DashboardWidget = {
  id: string;
  title: string;
  sourceModules: Array<{ id: string; name: string; officeName: string }>;
  // 0-2 dimensions -- with 2, each series row's label is their composite
  // ("Poblacion / M").
  groupBy: string[];
  chartType: WidgetChartType;
  sortOrder: number;
  showOnDashboard: boolean;
  measure: string;
  // True when any source program still holds SAMPLE-tagged records.
  hasSampleData?: boolean;
  // Owning office for charts made by office staff; null = city-wide (admin).
  officeId: string | null;
  // Only on the office routes: whether this office may edit/delete it.
  editable?: boolean;
  // Narrows the query without being a chart axis -- distinct from groupBy,
  // which always breaks every value of a dimension out.
  filterBarangayCode: string | null;
  filterBarangayName: string | null;
  filterSex: string | null;
  filterMonth: string | null;
  filterFieldKey: string | null;
  filterFieldValue: string | null;
};

// One row per group-by label; `counts[i]` is that label's count for
// `widget.sourceModules[i]`.
export type WidgetSeriesRow = { label: string | null; counts: number[] };

// Every module submission is multipart/form-data, even when it has no FILE
// fields -- one request shape for every module (see backend/src/routes/
// office.ts). Core fields go as individual text parts, admin-defined
// non-file fields as one JSON-encoded `fields` part, and FILE fields as
// actual file parts named by their field key.
function officeRecordFormData(
  // Undefined for a collectPersonInfo=false module -- it isn't about a
  // person at all, so there's no name/birthdate/etc. to send in the first
  // place (see office.ts's intake route, which never parses coreSchema for
  // one of these).
  core:
    | (PersonCore & { linkToCitizen?: boolean; householdParentKey?: string; householdRelation?: string })
    | undefined,
  fields: OfficeIntakeFieldValues,
  files: Record<string, File | undefined>,
): FormData {
  const fd = new FormData();
  if (core) {
    fd.set('lname', core.lname);
    fd.set('fname', core.fname);
    if (core.mname) fd.set('mname', core.mname);
    fd.set('bdate', core.bdate);
    if (core.sex) fd.set('sex', core.sex);
    if (core.civilStatus) fd.set('civilStatus', core.civilStatus);
    if (core.street) fd.set('street', core.street);
    if (core.brgyCode) fd.set('brgyCode', core.brgyCode);
    if (core.linkToCitizen !== undefined) fd.set('linkToCitizen', String(core.linkToCitizen));
    if (core.householdParentKey) fd.set('householdParentKey', core.householdParentKey);
    if (core.householdRelation) fd.set('householdRelation', core.householdRelation);
  }
  fd.set('fields', JSON.stringify(fields));
  for (const [key, file] of Object.entries(files)) {
    if (file) fd.set(key, file);
  }
  return fd;
}

// Program gaps (admin): see backend/src/services/programGaps.ts.
export type GapRuleKind = 'missing' | 'conflict';
export type GapRuleInput = {
  name: string;
  description: string | null;
  kind: GapRuleKind;
  targetModuleId: string;
  sourceModuleIds: string[];
  minAge: number | null;
  maxAge: number | null;
  sex: 'M' | 'F' | null;
  isActive: boolean;
};
export type GapRuleSummary = GapRuleInput & {
  id: string;
  targetProgram: { id: string; name: string; office: { id: string; name: string; shortName: string | null; accentHue: number; icon: string } } | null;
  sourcePrograms: string[];
  // null when the rule is switched off (not computed).
  total: number | null;
  byBarangay: Array<{ code: string | null; name: string | null; count: number }>;
  usesSampleData: boolean;
};
export type GapPerson = { personKey: string; name: string; age: number | null; sex: string | null; barangay: string | null; sourcePrograms: string[] };

// Disaster lists (admin): see backend/src/services/disasterLists.ts.
export type DisasterCategory = 'senior' | 'young_child' | 'pwd' | 'pregnant' | 'solo_parent';
export type DisasterBarangay = {
  code: string | null; name: string | null; people: number; households: number; evacuatedNow: number;
  reliefPeople: number; reliefHouseholds: number;
} & Record<DisasterCategory, number>;
export type ReliefEvent = { event: string; label: string; households: number; lastDate: string | null };
// Relief coverage for one event: who has / hasn't received.
export type ReliefFilter = { event?: string; relief?: 'received' | 'not_received' };
export type VulnerablePerson = {
  personKey: string; name: string; age: number | null; sex: string | null; street: string | null; barangay: string | null;
  householdKey: string; householdHead: string | null; needs: DisasterCategory[]; pregnancyNeedsCheck: boolean; evacuationCenter: string | null;
  reliefReceived: boolean | null;
};

// Business renewals (BPLO): see backend/src/services/businessRenewals.ts.
export type RenewalSummary = {
  year: number; total: number; renewed: number; notRenewed: number; lapsedLonger: number; noYear: number;
  byYear: Array<{ year: number | null; count: number }>;
  byStatusCode: Array<{ code: string | null; count: number; renewed: number }>;
  notRenewedByBarangay: Array<{ name: string | null; count: number }>;
  notRenewedByLine: Array<{ name: string | null; count: number }>;
};
export type RenewalBusiness = {
  recordId: string; businessName: string | null; tradeName: string | null; tan: string | null; line: string | null;
  barangay: string | null; lastYear: number | null; validUntil: string | null; permitNo: string | null; statusCode: string | null;
};
export type RenewalFilters = { lastYear?: number | 'none'; barangay?: string; line?: string; statusCode?: string; q?: string };

// Privacy (admin): see backend/src/services/privacy.ts and routes/adminPrivacy.ts.
export type AccessEntry = { id: string; at: string; who: string; office: string | null; role: string | null; what: string };
export type AccessReport = {
  month: string;
  people: Array<{ who: string; office: string | null; role: string | null; views: number; exports: number; rowsExported: number }>;
  exports: Array<{ id: string; at: string; who: string; office: string | null; what: string; rows: number | null }>;
};
export type DataRequestKind = 'access' | 'correction' | 'erasure' | 'objection' | 'other';
export type DataRequest = {
  id: string; personKey: string | null; requesterName: string; contact: string | null; kind: DataRequestKind; details: string | null;
  receivedOn: string; status: 'open' | 'done' | 'declined'; response: string | null; closedOn: string | null; createdAt: string; updatedAt: string;
};

// Bulk import (office staff): see backend/src/services/officeImport.ts.
export type ImportRowResult = { row: number; name: string | null; outcome: string; errors?: string[] };

// An office's Home to-do list (counts only): backend services/officeTodo.ts.
export type TodoItem = { key: string; count: number; label: string; detail: string; go: string };

// Insights page (admin): backend services/cityInsights.ts.
export type CityInsights = {
  underserved: {
    rules: Array<{ id: string; name: string }>;
    barangays: Array<{ code: string | null; name: string | null; residents: number; notServed: number; byRule: Record<string, number> }>;
  };
  reach: {
    households: number;
    byPrograms: Array<{ bucket: '0' | '1' | '2-3' | '4+'; households: number }>;
    vulnerableNone: number;
    vulnerableNoneByBarangay: Array<{ name: string | null; households: number }>;
  };
  pace: Array<{ id: string; name: string; program: string; office: string; gap: number; perMonth: number; months: number | null }>;
  quality: Array<{ officeId: string; office: string; records: number; sample: number; unlinked: number; pendingReview: number; noBarangay: number; noSex: number; noBirthdate: number }>;
};

// Linking saved records to the registry: backend services/registryLinking.ts.
export type RegistryLinks = {
  unlinked: number; withCandidates: number; sure: number; page: number; pageSize: number;
  items: Array<{
    recordId: string; name: string; bdate: string | null; context: string | null; sure: boolean;
    candidates: Array<{ personKey: string; name: string; bdate: string | null; barangay: string | null; similarity: number; exactName: boolean; sameBirthdate: boolean; programs: string[] }>;
  }>;
};

// City overview "Needs attention" tiles: backend services/cityAttention.ts.
export type CityAttention = {
  gaps: { notServed: number; cleanup: number };
  disaster: { evacuatedNow: number; relief: { label: string; notReached: number; households: number } | null };
  renewals: { year: number; notRenewed: number };
  privacy: { open: number; oldestDays: number | null };
};

// Program summary report: backend services/programReport.ts.
export type ProgramReport = {
  from: string; to: string; total: number; people: number; notLinked: number; sample: number;
  bySex: Array<{ name: string; count: number }>; byAge: Array<{ name: string; count: number }>;
  byBarangay: Array<{ name: string; count: number }>; byMonth: Array<{ month: string; count: number }>;
};
// Heritage zone (admin): backend services/heritageZone.ts.
export type HeritageSummary = {
  barangays: Array<{ code: string; name: string }>;
  allBarangays: Array<{ code: string; name: string }>;
  year: number;
  businesses: { total: number; renewed: number; notRenewed: number; lapsed: number; noYear: number; byBarangay: Array<{ name: string; total: number; notRenewed: number }> };
  buildingPermits: { total: number; thisYear: number; byFlag: number; byBarangay: Array<{ name: string; count: number }>; byUse: Array<{ name: string; count: number }> };
  occupancyPermits: { total: number; thisYear: number };
  zoning: { total: number; byDecision: Array<{ name: string; count: number }> };
  usesSampleData: boolean;
};

const listBase = (officeId?: string) => (officeId ? `/offices/${officeId}` : '/admin');

export const api = {
  login: (username: string, password: string) =>
    request<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<Session>('/auth/me'),
  barangays: () => request<Array<{ code: string; name: string }>>('/barangays'),

  // --- Office (office_staff-facing) -------------------------------------------
  getOffice: (officeId: string) => request<Office>(`/offices/${officeId}`).then((o) => (registerShortNames([o]), o)),
  getOfficeModules: (officeId: string) => request<OfficeModule[]>(`/offices/${officeId}/modules`),
  registryLinks: (officeId: string, moduleId: string, page: number) =>
    request<RegistryLinks>(`/offices/${officeId}/modules/${moduleId}/registry-links${queryString({ page })}`),
  linkRegistryRecord: (officeId: string, moduleId: string, recordId: string, personKey: string) =>
    request<{ linked: number }>(`/offices/${officeId}/modules/${moduleId}/registry-links`, { method: 'POST', body: JSON.stringify({ recordId, personKey }) }),
  linkRegistrySure: (officeId: string, moduleId: string) =>
    request<{ linked: number }>(`/offices/${officeId}/modules/${moduleId}/registry-links/sure`, { method: 'POST' }),
  importRecords: (officeId: string, moduleId: string, body: { dryRun: boolean; batchId?: string; fileName?: string; rows: Array<{ core: Record<string, string>; fields: Record<string, string> }> }) =>
    request<{ batchId: string; results: ImportRowResult[] }>(`/offices/${officeId}/modules/${moduleId}/import`, { method: 'POST', body: JSON.stringify(body) }),
  getOfficeModuleFields: (officeId: string, moduleId: string) =>
    request<OfficeFormField[]>(`/offices/${officeId}/modules/${moduleId}/fields`),
  // Backs the household-link picker on an office's own intake form -- top
  // 20 matches, no pagination (see the backend route's comment for why
  // this is separate from admin's paginated /admin/citizens).
  officeCitizenSearch: (officeId: string, q: string) =>
    request<CitizenListItem[]>(`/offices/${officeId}/citizen-search${queryString({ q })}`),
  submitOfficeRecord: (
    officeId: string,
    moduleId: string,
    core: (PersonCore & { linkToCitizen?: boolean; householdParentKey?: string; householdRelation?: string }) | undefined,
    fields: OfficeIntakeFieldValues,
    files: Record<string, File | undefined> = {},
  ) =>
    request<IntakeResult>(`/offices/${officeId}/modules/${moduleId}/records`, {
      method: 'POST',
      body: officeRecordFormData(core, fields, files),
    }),
  myOfficeModuleRecords: (officeId: string, moduleId: string, q?: string, page?: number, status?: RecordStatus, archived?: boolean) =>
    request<OfficeRecordList>(
      `/offices/${officeId}/modules/${moduleId}/records${queryString({ q, page, status, archived: archived ? 'true' : undefined })}`,
    ),
  // Correct a record's form fields (and, for a record not linked to a
  // citizen, its name/birthdate). Reason required; audited with before/after.
  editOfficeRecord: (
    officeId: string,
    moduleId: string,
    recordId: string,
    body: { reason: string; fields: OfficeIntakeFieldValues; person?: { lname?: string; fname?: string; mname?: string; bdate?: string } },
  ) =>
    request<{ status: string; changed: number }>(`/offices/${officeId}/modules/${moduleId}/records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  openRecordFile: (officeId: string, moduleId: string, recordId: string, fieldKey: string) =>
    openInNewTab(`/offices/${officeId}/modules/${moduleId}/records/${recordId}/files/${fieldKey}`),
  restoreOfficeRecord: (officeId: string, moduleId: string, recordId: string, reason: string) =>
    request<void>(`/offices/${officeId}/modules/${moduleId}/records/${recordId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  exportModuleRecords: (officeId: string, moduleId: string) =>
    download(`/offices/${officeId}/modules/${moduleId}/records/export.csv`, 'records.csv'),
  exportMasterlist: () => download('/admin/citizens/export.csv', 'citizen-masterlist.csv'),
  // Program gaps and disaster lists: officeId set = that office's own view
  // (/offices/:id/...), unset = admin's whole-city view (/admin/...).
  accessHistory: (personKey: string) => request<{ entries: AccessEntry[] }>(`/admin/privacy/people/${personKey}/access`),
  privacyAccess: (month: string) => request<AccessReport>(`/admin/privacy/access${queryString({ month })}`),
  dataRequests: (f: { status?: string; personKey?: string } = {}) => request<DataRequest[]>(`/admin/privacy/requests${queryString(f)}`),
  createDataRequest: (input: { requesterName: string; personKey: string | null; contact: string | null; kind: DataRequestKind; details: string | null; receivedOn: string }) =>
    request<DataRequest>('/admin/privacy/requests', { method: 'POST', body: JSON.stringify(input) }),
  updateDataRequest: (id: string, input: { status?: DataRequest['status']; response?: string | null; closedOn?: string | null }) =>
    request<DataRequest>(`/admin/privacy/requests/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  programReport: (officeId: string, moduleId: string, from: string, to: string) =>
    request<ProgramReport>(`/offices/${officeId}/modules/${moduleId}/report${queryString({ from, to })}`),
  exportProgramReport: (officeId: string, moduleId: string, from: string, to: string) =>
    download(`/offices/${officeId}/modules/${moduleId}/report.csv${queryString({ from, to })}`, 'report.csv'),
  heritage: () => request<HeritageSummary>('/admin/heritage'),
  setHeritageBarangays: (codes: string[]) => request<{ codes: string[] }>('/admin/heritage/barangays', { method: 'PUT', body: JSON.stringify({ codes }) }),
  cityAttention: () => request<CityAttention>('/admin/insights/attention'),
  cityInsights: () => request<CityInsights>('/admin/insights/questions'),
  officeTodo: (officeId: string) => request<TodoItem[]>(`/offices/${officeId}/todo`),
  officeLists: (officeId: string) => request<{ programGaps: number; disasterLists: boolean; businessRenewals: boolean }>(`/offices/${officeId}/lists`),
  renewalSummary: (officeId?: string) => request<RenewalSummary>(`${listBase(officeId)}/business-renewals`),
  renewalList: (officeId: string | undefined, page: number, f: RenewalFilters) =>
    request<Paginated<RenewalBusiness>>(`${listBase(officeId)}/business-renewals/list${queryString({ page, ...f, lastYear: f.lastYear === undefined ? undefined : String(f.lastYear) })}`),
  exportRenewals: (officeId: string | undefined, f: RenewalFilters) =>
    download(`${listBase(officeId)}/business-renewals/list.csv${queryString({ ...f, lastYear: f.lastYear === undefined ? undefined : String(f.lastYear) })}`, 'business-renewals.csv'),
  reliefForm: (officeId: string) =>
    request<{ moduleId: string; name: string; fields: OfficeFormField[] } | null>(`/offices/${officeId}/disaster-lists/relief-form`),
  markReliefReceived: (officeId: string, personKey: string, fields: Record<string, unknown>) =>
    request<{ recordId: string }>(`/offices/${officeId}/disaster-lists/relief`, { method: 'POST', body: JSON.stringify({ personKey, fields }) }),
  disasterSummary: (officeId?: string, event?: string) =>
    request<{ totals: DisasterBarangay; barangays: DisasterBarangay[]; usesSampleData: boolean; reliefEvents: ReliefEvent[] }>(`${listBase(officeId)}/disaster-lists${queryString({ event })}`),
  disasterPeople: (officeId: string | undefined, page: number, barangayCode?: string, category?: DisasterCategory, rf: ReliefFilter = {}) =>
    request<Paginated<VulnerablePerson>>(`${listBase(officeId)}/disaster-lists/people${queryString({ page, barangayCode, category, ...rf })}`),
  disasterPrint: (officeId: string | undefined, barangayCode: string, rf: ReliefFilter = {}) =>
    request<{ total: number; items: VulnerablePerson[]; truncated: boolean }>(`${listBase(officeId)}/disaster-lists/print${queryString({ barangayCode, ...rf })}`),
  exportDisasterList: (officeId: string | undefined, barangayCode?: string, category?: DisasterCategory, rf: ReliefFilter = {}) =>
    download(`${listBase(officeId)}/disaster-lists/people.csv${queryString({ barangayCode, category, ...rf })}`, 'disaster-list.csv'),
  programGaps: (officeId: string | undefined, barangayCode?: string) =>
    request<{ rules: GapRuleSummary[]; programs: Array<{ id: string; name: string; officeName: string }> }>(`${listBase(officeId)}/program-gaps${queryString({ barangayCode })}`),
  programGapPeople: (officeId: string | undefined, ruleId: string, page: number, barangayCode?: string) =>
    request<Paginated<GapPerson>>(`${listBase(officeId)}/program-gaps/${ruleId}/people${queryString({ page, barangayCode })}`),
  exportProgramGap: (officeId: string | undefined, ruleId: string, barangayCode?: string) =>
    download(`${listBase(officeId)}/program-gaps/${ruleId}/people.csv${queryString({ barangayCode })}`, 'program-gap.csv'),
  createProgramGapRule: (input: GapRuleInput) => request<GapRuleInput & { id: string }>('/admin/program-gaps', { method: 'POST', body: JSON.stringify(input) }),
  updateProgramGapRule: (id: string, input: Partial<GapRuleInput>) =>
    request<GapRuleInput & { id: string }>(`/admin/program-gaps/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  // Soft-delete (sets isArchived) -- works for office_staff on their own
  // module and for admin on any module. `reason` is required and lands in
  // the audit log, not on the record itself.
  archiveOfficeRecord: (officeId: string, moduleId: string, recordId: string, reason: string) =>
    request<void>(`/offices/${officeId}/modules/${moduleId}/records/${recordId}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }),

  // --- Admin: manage offices + modules + fields -------------------------------
  listOffices: () => request<Office[]>('/admin/offices').then((os) => (registerShortNames(os), os)),
  createOffice: (data: { name: string; slug: string; description?: string; accentHue?: number; icon?: string; collectPersonInfo?: boolean; requiresCitizenLink?: boolean }) =>
    request<Office>('/admin/offices', { method: 'POST', body: JSON.stringify(data) }),
  updateOffice: (id: string, data: { name?: string; description?: string | null; isActive?: boolean; accentHue?: number; icon?: string; shortName?: string | null }) =>
    request<Office>(`/admin/offices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // force=true also removes any of this office's modules that are
  // genuinely empty (no records, not used as a dashboard widget source) --
  // still blocked if any module has either.
  deleteOffice: (id: string, force?: boolean) =>
    request<void>(`/admin/offices/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),

  listOfficeModules: (officeId: string) => request<OfficeModule[]>(`/admin/offices/${officeId}/modules`),
  createOfficeModule: (
    officeId: string,
    data: {
      name: string;
      slug: string;
      requiresCitizenLink?: boolean;
      collectSex?: boolean;
      collectCivilStatus?: boolean;
      collectStreet?: boolean;
      collectBarangay?: boolean;
      collectPersonInfo?: boolean;
    },
  ) => request<OfficeModule>(`/admin/offices/${officeId}/modules`, { method: 'POST', body: JSON.stringify(data) }),
  updateOfficeModule: (
    officeId: string,
    moduleId: string,
    data: {
      name?: string;
      requiresCitizenLink?: boolean;
      sortOrder?: number;
      collectSex?: boolean;
      collectCivilStatus?: boolean;
      collectStreet?: boolean;
      collectBarangay?: boolean;
      collectPersonInfo?: boolean;
    },
  ) =>
    request<OfficeModule>(`/admin/offices/${officeId}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteOfficeModule: (officeId: string, moduleId: string) =>
    request<void>(`/admin/offices/${officeId}/modules/${moduleId}`, { method: 'DELETE' }),

  listOfficeModuleFields: (officeId: string, moduleId: string) =>
    request<OfficeFormField[]>(`/admin/offices/${officeId}/modules/${moduleId}/fields`),
  createOfficeModuleField: (
    officeId: string,
    moduleId: string,
    data: { label: string; fieldType: OfficeFieldType; options?: string[]; isRequired?: boolean },
  ) =>
    request<OfficeFormField>(`/admin/offices/${officeId}/modules/${moduleId}/fields`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateOfficeModuleField: (
    officeId: string,
    moduleId: string,
    fieldId: string,
    data: { label?: string; options?: string[]; isRequired?: boolean; sortOrder?: number },
  ) =>
    request<OfficeFormField>(`/admin/offices/${officeId}/modules/${moduleId}/fields/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteOfficeModuleField: (officeId: string, moduleId: string, fieldId: string) =>
    request<void>(`/admin/offices/${officeId}/modules/${moduleId}/fields/${fieldId}`, { method: 'DELETE' }),

  // --- Admin: custom dashboard visualizations --------------------------------
  listDashboardWidgets: () => request<DashboardWidget[]>('/admin/dashboard/widgets'),
  createDashboardWidget: (data: DashboardWidgetPayload) =>
    request<DashboardWidget>('/admin/dashboard/widgets', { method: 'POST', body: JSON.stringify(data) }),
  updateDashboardWidget: (id: string, data: DashboardWidgetPayload) =>
    request<DashboardWidget>(`/admin/dashboard/widgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDashboardWidget: (id: string) => request<void>(`/admin/dashboard/widgets/${id}`, { method: 'DELETE' }),
  setWidgetOnDashboard: (id: string, showOnDashboard: boolean) =>
    request<DashboardWidget>(`/admin/dashboard/widgets/${id}/dashboard`, { method: 'PATCH', body: JSON.stringify({ showOnDashboard }) }),
  getDashboardWidgetData: (id: string) => request<WidgetSeriesRow[]>(`/admin/dashboard/widgets/${id}/data`),
  // One office's own charts (office staff; admin may use them too).
  listOfficeWidgets: (officeId: string) => request<DashboardWidget[]>(`/offices/${officeId}/widgets`),
  createOfficeWidget: (officeId: string, data: DashboardWidgetPayload) =>
    request<DashboardWidget>(`/offices/${officeId}/widgets`, { method: 'POST', body: JSON.stringify(data) }),
  updateOfficeWidget: (officeId: string, id: string, data: DashboardWidgetPayload) =>
    request<DashboardWidget>(`/offices/${officeId}/widgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteOfficeWidget: (officeId: string, id: string) => request<void>(`/offices/${officeId}/widgets/${id}`, { method: 'DELETE' }),
  setOfficeWidgetOnDashboard: (officeId: string, id: string, showOnDashboard: boolean) =>
    request<DashboardWidget>(`/offices/${officeId}/widgets/${id}/dashboard`, { method: 'PATCH', body: JSON.stringify({ showOnDashboard }) }),
  getOfficeWidgetData: (officeId: string, id: string) => request<WidgetSeriesRow[]>(`/offices/${officeId}/widgets/${id}/data`),

  reviewQueue: () => request<ReviewQueueItem[]>('/admin/duplicate-review-queue'),
  approveReview: (id: string, winningPersonKey: string) =>
    request<{ status: 'approved'; winningPersonKey: string }>(`/admin/duplicate-review-queue/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ winningPersonKey }),
    }),
  rejectReview: (id: string) =>
    request<{ status: 'rejected'; personKey: string }>(`/admin/duplicate-review-queue/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  searchCitizens: (q: string, page?: number) =>
    request<Paginated<CitizenListItem>>(`/admin/citizens${queryString({ q, page })}`),
  citizen360: (personKey: string) => request<Citizen360>(`/admin/citizens/${personKey}`),
  updateGovernmentIds: (personKey: string, data: { sss?: string; gsis?: string; philhealth?: string }) =>
    request<void>(`/admin/citizens/${personKey}/government-ids`, { method: 'PATCH', body: JSON.stringify(data) }),
  dashboardSummary: () => request<DashboardSummary>('/admin/dashboard/summary'),
  // q: head's or any member's name, or an exact person_key.
  households: (page?: number, q?: string) => request<Paginated<HouseholdListItem>>(`/admin/households${queryString({ page, q })}`),
  household: (headPersonKey: string) => request<HouseholdDetail>(`/admin/households/${headPersonKey}`),
  // Households aren't a separate table -- "creating" one just designates an
  // existing citizen as a head; adding a member links another existing
  // citizen to it. See the backend route's comment for why no new Citizen
  // is ever created by any of these.
  createHousehold: (headPersonKey: string) =>
    request<{ headPersonKey: string }>('/admin/households', { method: 'POST', body: JSON.stringify({ headPersonKey }) }),
  addHouseholdMember: (headPersonKey: string, personKey: string, relationToHead: string) =>
    request<{ personKey: string; headPersonKey: string; relationToHead: string }>(
      `/admin/households/${headPersonKey}/members`,
      { method: 'POST', body: JSON.stringify({ personKey, relationToHead }) },
    ),
  removeHouseholdMember: (headPersonKey: string, personKey: string) =>
    request<void>(`/admin/households/${headPersonKey}/members/${personKey}`, { method: 'DELETE' }),
  disbandHousehold: (headPersonKey: string) =>
    request<void>(`/admin/households/${headPersonKey}`, { method: 'DELETE' }),

  insightsSummary: (filters: InsightsFilters = {}) => request<InsightsSummary>(`/admin/insights/summary${queryString(filters)}`),
  insightsSankey: (filters: InsightsFilters = {}) => request<SankeyData>(`/admin/insights/sankey${queryString(filters)}`),
  insightsBarangayRanking: (filters: Pick<InsightsFilters, 'from' | 'to'> = {}) =>
    request<BarangayRankingRow[]>(`/admin/insights/barangay-ranking${queryString(filters)}`),
  insightsTrend: (filters: Pick<InsightsFilters, 'from' | 'to'> = {}) =>
    request<TrendPoint[]>(`/admin/insights/trend${queryString(filters)}`),
  officeBreakdown: (filters: InsightsFilters = {}) =>
    request<OfficeBreakdown>(`/admin/insights/office-breakdown${queryString(filters)}`).then((b) => (registerShortNames(b.offices), b)),
  insightsCitizens: (filters: InsightsFilters & { bucket?: string; limit?: number } = {}) =>
    request<InsightsCitizenRow[]>(`/admin/insights/citizens${queryString(filters)}`),

  staffAccounts: () => request<StaffAccount[]>('/admin/staff-accounts'),
  createStaffAccount: (data: { username: string; fullName: string; position?: string; role: StaffRole; officeId?: string; password?: string }) =>
    request<{ account: StaffAccount; oneTimePassword: string }>('/admin/staff-accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  // Username is deliberately not editable -- see the backend route's
  // comment. officeId: null clears it (switching to admin); omitted keeps
  // whatever the account already has.
  updateStaffAccount: (id: string, data: { fullName?: string; position?: string | null; role?: StaffRole; officeId?: string | null }) =>
    request<StaffAccount>(`/admin/staff-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deactivateStaffAccount: (id: string) =>
    request<StaffAccount>(`/admin/staff-accounts/${id}/deactivate`, { method: 'PATCH' }),
  deleteStaffAccount: (id: string) => request<void>(`/admin/staff-accounts/${id}`, { method: 'DELETE' }),
  reactivateStaffAccount: (id: string) =>
    request<StaffAccount>(`/admin/staff-accounts/${id}/reactivate`, { method: 'PATCH' }),
  resetStaffAccountPassword: (id: string, password: string) =>
    request<void>(`/admin/staff-accounts/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),

  settings: () => request<AppSettings>('/admin/settings'),
  updateSetting: (key: keyof AppSettings, value: string) =>
    request<{ key: string; value: string }>('/admin/settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),
};
