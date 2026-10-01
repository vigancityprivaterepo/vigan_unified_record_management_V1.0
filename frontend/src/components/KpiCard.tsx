export type KpiTile = { label: string; value: number | string; icon: string; className: string };

// Single KPI tile -- extracted so AdminDashboardPage and AdminInsightsPage
// share one implementation instead of each defining their own copy of the
// same `.kpi-card`/`.kpi-icon`/`.kpi-label`/`.kpi-value` markup.
export function KpiCard({ label, value, icon, className }: KpiTile) {
  return (
    <div className={`kpi-card ${className}`}>
      <div className="kpi-top">
        <div className="kpi-identity">
          <div className={`kpi-icon ${className.replace('c-', '')}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" dangerouslySetInnerHTML={{ __html: icon }} />
          </div>
          <span className="kpi-label">{label}</span>
        </div>
      </div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
