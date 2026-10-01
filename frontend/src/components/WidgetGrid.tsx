import { WidgetCard } from '@/components/WidgetCard';
import type { DashboardWidget } from '@/lib/api';

// Two-column grid of saved widgets, each editable/removable -- used on the
// Visualizations page where widgets are managed. The Dashboard renders
// WidgetCard directly (no edit/delete) since it's a viewing surface only.
export function WidgetGrid({
  widgets,
  onEdit,
  onDelete,
}: {
  widgets: DashboardWidget[];
  onEdit: (widget: DashboardWidget) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
      {widgets.map((w) => (
        <div className="col-6" key={w.id}>
          <WidgetCard widget={w} onEdit={() => onEdit(w)} onDelete={() => onDelete(w.id)} />
        </div>
      ))}
    </div>
  );
}
