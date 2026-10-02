import { useState } from 'react';
import { VisualizationForm, type VisualizationFormValues } from '@/components/VisualizationForm';
import { useVisualizationFormData } from '@/hooks/useVisualizationFormData';
import { api } from '@/lib/api';

// Split out from the combined Visualizations page -- see
// AllVisualizationsPage.tsx for the widget grid + edit flow that used to
// live below this form.
export function CreateVisualizationPage() {
  const { offices, modulesByOffice, barangays } = useVisualizationFormData();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function handleCreate(values: VisualizationFormValues) {
    setError(null);
    setCreated(null);
    await api.createDashboardWidget(values);
    setCreated(values.title);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="hero">
        <div className="hero-text">
          <h1 className="hero-title">New visualization</h1>
        </div>
      </div>

      {created && (
        <div className="alert success">
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <div className="body">
            &ldquo;{created}&rdquo; created. Go to <strong>All Visualizations</strong> to view it.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="card-title-wrap">
            <h3 className="card-title">Create a visualization</h3>
          </div>
        </div>

        {error && (
          <div className="field-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <VisualizationForm
          key="create"
          offices={offices}
          modulesByOffice={modulesByOffice}
          barangays={barangays}
          submitLabel="Add visualization"
          submittingLabel="Adding..."
          onSubmit={handleCreate}
        />
      </div>
    </div>
  );
}
