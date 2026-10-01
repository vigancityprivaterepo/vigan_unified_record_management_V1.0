import type { StaffRole } from '@/lib/api';

const OFFICE_HELP: Array<[string, string]> = [
  ['Register someone', 'Pick a program under your office in the sidebar and choose New registration. Step 1 checks the city registry for the person first, so nobody gets entered twice.'],
  ['Registry status', '“Linked to registry” means the person already existed. “New citizen added” means this registration created them. “Awaiting admin review” means the name was close to someone else’s and an administrator will decide.'],
  ['Find a record', 'Use the search box at the top, or open Records and filter by status.'],
  ['Remove a mistake', 'Use the archive button on the record. You’ll be asked for a reason; it goes into the audit trail.'],
];

const ADMIN_HELP: Array<[string, string]> = [
  ['Overview', 'Entries per month for every office, the share of the workload, and the busiest barangays. Click a barangay to filter the page.'],
  ['Duplicate review', 'Intakes whose name and birthdate were close to an existing citizen wait here until you approve (same person) or reject (different person).'],
  ['Office workspaces', 'Open any office’s records exactly as its staff see them, read-only.'],
  ['Offices', 'Create offices, give each its own color and icon, and set up the forms its staff fill in.'],
  ['Exports', 'Export masterlist (Overview) and each program’s list are CSV files with personal data. Every export is recorded in the audit log.'],
];

export function HelpContent({ role }: { role: StaffRole }) {
  const items = role === 'admin' ? ADMIN_HELP : OFFICE_HELP;
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
