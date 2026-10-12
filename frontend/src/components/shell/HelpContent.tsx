import type { OfficeModule, StaffRole } from '@/lib/api';

// Help: one line per page or task, describing what the app does today.
// Office staff only see entries for pages their office has (Program gaps,
// Disaster lists, Business renewals, Link to registry).
type Item = [string, string];

const OFFICE_BASE: Item[] = [
  ['Home', '“Needs your attention” counts the people or businesses your office should follow up. Click a line to open the list with the names. Below it, each program has Records and New registration.'],
  ['Register someone', 'Pick a program under your office in the sidebar and choose New registration. Step 1 checks the city registry for the person first, so nobody gets entered twice.'],
  ['Registry status', '“Linked to registry” means the person already existed. “New citizen added” means this registration created them. “Awaiting administrator review” means the name was close to someone else’s and an administrator will decide.'],
  ['Find a record', 'Use the search box at the top, or open Records and filter by status.'],
  ['Correct a record', 'Use the Edit button on the record and give a reason. The old and new values are saved to the audit trail. To fix the name or birthdate of a registered citizen, ask an administrator.'],
  ['Remove a mistake', 'Use the Archive button on the record and give a reason. Archived records stay under the Archived filter, where Restore brings them back.'],
  ['Import from a spreadsheet', 'On Records, choose Import and pick a CSV file. Match its columns to the form, then Check rows: nothing is saved until you import. Rows with problems are skipped and can be downloaded to fix.'],
  ['Charts', 'Build charts from your office’s programs on Charts. Pin to Home shows a chart on your Home page. Open a chart and click a bar, slice or point to list the records it counts. History shows the same numbers month by month, and Data used shows what each program collects and how completely it is filled in. Opening or exporting the records is recorded in the audit log.'],
  ['Report', 'On Records, Report counts a program’s registrations for any period by sex, age group, barangay and month. Print it or export it as CSV.'],
];

const OFFICE_GAPS: Item = ['Program gaps', 'People who qualify for your programs but are not in them yet, and lists that need cleanup, such as deceased people still on a list. The city administrator sets the rules. Opening and exporting a list is recorded in the audit log.'];
const OFFICE_DISASTER: Item = ['Disaster lists', 'Residents who may need help to evacuate (seniors, children under 5, PWD, pregnant women, solo parents) by barangay and household. Print one barangay’s list for rescue teams. Choose a relief event to see who has not received relief yet, and use Mark received as each household gets it. Each household can claim once per event.'];
const OFFICE_RENEWALS: Item = ['Business renewals', 'Businesses whose latest permit is older than this year, by barangay and line of business. Filter the list and export it to follow up with owners.'];
const OFFICE_LINK: Item = ['Link to registry', 'For programs where the registry link is optional, Records has Link to registry. Compare each saved name with the possible citizen (birthdate, barangay) and link only when sure. Matches with the same name and birthdate can be linked all at once.'];

const ADMIN_HELP: Item[] = [
  ['Overview', 'Which barangays the city’s programs reach, entries per month by office, and citizens in more than one program. Click a barangay to filter the page. Export masterlist downloads every citizen.'],
  ['Visualizations', 'Build charts from any office’s programs. Add to dashboard shows a chart on the dashboard. Open a chart and click a bar, slice or point to list the records it counts. History shows the same numbers month by month, and Data used shows what each program collects and how completely it is filled in. Opening or exporting the records is recorded in the audit log.'],
  ['Insights', 'Charts across all offices: program combinations, barangay ranking, underserved barangays, households by number of programs, registrations over time, and what each office must fix in its data. Click a bar or a point to filter the page.'],
  ['Citizens and Households', 'Look up a person or a household. A citizen’s profile shows their records in every office, and under Privacy, who viewed or changed the record.'],
  ['Program gaps', 'People who qualify for a program but are not in it, and lists that need cleanup. Manage rules adds, edits or switches off a rule. Each office sees the rules for its own programs.'],
  ['Disaster lists', 'Residents who may need help to evacuate, by barangay and household, and who has received relief for an event. CDRRMO records relief from its own Disaster lists.'],
  ['Business renewals', 'Businesses whose latest permit is older than this year, from BPLO’s Business Permits records.'],
  ['Heritage zone', 'Businesses, building and occupancy permits and zoning clearances inside the barangays you mark as the heritage zone. Choose barangays sets which ones count.'],
  ['Duplicate review', 'Registrations whose name and birthdate were close to an existing citizen wait here until you approve (same person) or reject (different person).'],
  ['Office workspaces', 'Open any office’s records exactly as its staff see them, read-only.'],
  ['Offices', 'Create offices. Manage opens an office’s details, its programs and forms, and its color and icon.'],
  ['Staff accounts', 'Add staff accounts, reset passwords, and deactivate accounts that are no longer used. Deactivating keeps the person’s name in the audit log.'],
  ['Matching settings', 'How close two registrations must be before they are treated as the same citizen.'],
  ['Privacy', 'For the Data Protection Officer: who viewed and exported citizens’ data each month, and citizens’ requests to see, correct or delete their data.'],
  ['Exports', 'Export masterlist (Overview) and each program’s list are CSV files with personal data. Every export is recorded in the audit log.'],
];

export function HelpContent({ role, lists, modules = [] }: {
  role: StaffRole;
  // Office staff: which shared lists their office has (GET /offices/:id/lists).
  lists?: { programGaps: number; disasterLists: boolean; businessRenewals?: boolean } | null;
  modules?: OfficeModule[];
}) {
  const items = role === 'admin'
    ? ADMIN_HELP
    : [
        ...OFFICE_BASE,
        ...(modules.some((m) => m.collectPersonInfo && !m.requiresCitizenLink) ? [OFFICE_LINK] : []),
        ...(lists?.programGaps ? [OFFICE_GAPS] : []),
        ...(lists?.disasterLists ? [OFFICE_DISASTER] : []),
        ...(lists?.businessRenewals ? [OFFICE_RENEWALS] : []),
      ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {items.map(([title, body], i) => (
        <div key={title} className="ws-steps-help">
          <b>{i + 1}</b>
          <div>
            <div style={{ fontWeight: 600 }}>{title}</div>
            <div style={{ color: 'var(--t-muted)' }}>{body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
