import type { InsightsCitizenRow } from '@/lib/api';

export function InsightsDrilldownTable({
  rows,
  onSelectPerson,
}: {
  rows: InsightsCitizenRow[];
  onSelectPerson: (row: InsightsCitizenRow) => void;
}) {
  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--t-muted)' }}>No citizens match the current filters.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Barangay</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.personKey} onClick={() => onSelectPerson(r)} style={{ cursor: 'pointer' }}>
              <td className="cell-name">
                {r.personFname} {r.personLname}
              </td>
              <td>{r.barangayName ?? 'No barangay'}</td>
              <td>{r.personIsHead ? 'Household head' : 'Member'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
