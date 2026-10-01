import { useCallback, useState } from 'react';
import { ImportRecordsDialog } from '@/components/ImportRecordsDialog';
import { Icon } from '@/components/Icon';
import { OfficeModuleRecordsPanel } from '@/components/OfficeModuleRecordsPanel';
import { api, ApiError, type OfficeModule, type OfficeRecordList } from '@/lib/api';
import { moduleIcon } from '@/lib/officeTheme';

// Same records panel as before -- this level adds the workspace header, and a
// read-only banner + no "New registration" button when admin is viewing.
export function DynamicOfficeRecordsPage({ officeId, officeName, module: officeModule, readOnly = false, onNew, initialQuery }: {
  officeId: string;
  officeName: string;
  module: OfficeModule;
  readOnly?: boolean;
  onNew?: () => void;
  initialQuery?: string;
}) {
  const [stats, setStats] = useState<{ total: number; month: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Header counts are the unfiltered record totals, not the current chip's.
  const handleLoaded = useCallback((r: OfficeRecordList) => {
    setStats({ total: r.counts.all - r.counts.review, month: r.addedThisMonth });
  }, []);

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      await api.exportModuleRecords(officeId, officeModule.id);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // Bulk import from a spreadsheet; the records list reloads after it.
  const [importing, setImporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {readOnly && (
        <div className="ws-readonly"><Icon name="lock" size={16} />You’re viewing {officeName} records as administrator. Read-only.</div>
      )}
      <div className="ws-page-head">
        <div className="ws-tile ws-tile--lg"><Icon name={moduleIcon(officeModule)} size={26} strokeWidth={1.8} /></div>
        <div className="grow">
          <h1>{officeModule.name}</h1>
          <p>{stats ? `${stats.total.toLocaleString()} on record · ${stats.month.toLocaleString()} added this month` : officeName}</p>
        </div>
        <button className="btn btn--ghost btn--lg" onClick={handleExport} disabled={exporting}>
          <Icon name="download" size={16} />
          {exporting ? 'Exporting...' : `Export ${officeModule.name} list`}
        </button>
        {!readOnly && (
          <button className="btn btn--ghost btn--lg" onClick={() => setImporting(true)}>
            <Icon name="list" size={16} />
            Import
          </button>
        )}
        {!readOnly && onNew && (
          <button className="btn btn--primary btn--lg" onClick={onNew}><Icon name="plus" size={16} strokeWidth={2.4} />New registration</button>
        )}
      </div>
      {exportError && (
        <div className="alert danger">
          <div className="body">{exportError}</div>
        </div>
      )}
      <div className="ws-card" style={{ padding: 4 }}>
        <OfficeModuleRecordsPanel
          key={reloadKey}
          officeId={officeId}
          officeModule={officeModule}
          readOnly={readOnly}
          initialQuery={initialQuery}
          onLoaded={handleLoaded}
        />
      </div>
      {importing && (
        <ImportRecordsDialog officeId={officeId} module={officeModule} onClose={() => setImporting(false)} onImported={() => setReloadKey((n) => n + 1)} />
      )}
    </div>
  );
}
