import { Icon } from '@/components/Icon';
import { OfficeModuleRecordsPanel } from '@/components/OfficeModuleRecordsPanel';
import type { OfficeModule } from '@/lib/api';
import { moduleIcon } from '@/lib/officeTheme';

// Same records panel as before -- this level adds the workspace header, and a
// read-only banner + no "New registration" button when admin is viewing.
export function DynamicOfficeRecordsPage({ officeId, officeName, module: officeModule, readOnly = false, onNew }: {
  officeId: string;
  officeName: string;
  module: OfficeModule;
  readOnly?: boolean;
  onNew?: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {readOnly && (
        <div className="ws-readonly"><Icon name="lock" size={16} />You’re viewing {officeName} records as administrator. Read-only.</div>
      )}
      <div className="ws-page-head">
        <div className="ws-tile ws-tile--lg"><Icon name={moduleIcon(officeModule)} size={26} strokeWidth={1.8} /></div>
        <div className="grow">
          <h1>{officeModule.name} records</h1>
          <p>{officeName}</p>
        </div>
        {!readOnly && onNew && (
          <button className="btn btn--primary btn--lg" onClick={onNew}><Icon name="plus" size={16} strokeWidth={2.4} />New registration</button>
        )}
      </div>
      <div className="ws-card" style={{ padding: 4 }}>
        <OfficeModuleRecordsPanel officeId={officeId} officeModule={officeModule} />
      </div>
    </div>
  );
}
