import { useEffect, useRef, useState } from 'react';
import { RecordSubjectPicker, SUBJECT_SETTINGS, type RecordSubject } from '@/components/RecordSubjectPicker';
import { IconButton } from '@/components/IconButton';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { OfficeAppearancePicker } from '@/components/OfficeAppearancePicker';
import { OfficeModuleRecordsPanel } from '@/components/OfficeModuleRecordsPanel';
import type { AdminTab } from '@/components/shell/AdminSidebar';
import { compact, shortName } from '@/components/shell/OfficeSidebar';
import { CreateOfficeForm } from '@/pages/CreateOfficePage';
import { EYE_ICON, FOLDER_ICON, GEAR_ICON, TRASH_ICON } from '@/lib/actionIcons';
import { officeAppearance, officeColor } from '@/lib/officeTheme';
import { slugifyPreview } from '@/lib/slugify';
import { api, ApiError, type Office, type OfficeFieldType, type OfficeFormField, type OfficeModule } from '@/lib/api';

const FIELD_TYPE_LABELS: Record<OfficeFieldType, string> = {
  TEXT: 'Text',
  TEXTAREA: 'Long text',
  NUMBER: 'Number',
  DATE: 'Date',
  TIME: 'Time',
  BOOLEAN: 'Yes / No',
  SELECT: 'Dropdown',
  MULTISELECT: 'Multi-select',
  EMAIL: 'Email',
  PHONE: 'Phone number',
  FILE: 'File upload',
};
const FIELD_TYPES: OfficeFieldType[] = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'TIME',
  'BOOLEAN',
  'SELECT',
  'MULTISELECT',
  'EMAIL',
  'PHONE',
  'FILE',
];

export function AllOfficesPage({ onNavigate }: { onNavigate?: (tab: AdminTab, filter?: string) => void } = {}) {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  // Which part of Manage office is open in its own popup.
  const [section, setSection] = useState<'details' | 'programs' | 'appearance' | null>(null);
  const [search, setSearch] = useState('');

  function load() {
    api
      .listOffices()
      .then(setOffices)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load offices'));
  }

  useEffect(load, []);

  const managing = offices?.find((o) => o.id === managingId) ?? null;

  async function handleToggleActive(office: Office) {
    setError(null);
    setBusyId(office.id);
    try {
      await api.updateOffice(office.id, { isActive: !office.isActive });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update office');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(office: Office) {
    if (!window.confirm(`Permanently delete "${office.name}"? This cannot be undone.`)) return;
    setError(null);
    setBusyId(office.id);
    try {
      await api.deleteOffice(office.id);
      setManagingId(null);
      load();
    } catch (err) {
      
      if (err instanceof ApiError && err.code === 'OFFICE_HAS_MODULES' && err.details && typeof err.details === 'object' && 'moduleCount' in err.details) {
        const moduleCount = (err.details as { moduleCount: number }).moduleCount;
        if (window.confirm(`This office has ${moduleCount} module(s). Delete them too (only if empty), then the office?`)) {
          try {
            await api.deleteOffice(office.id, true);
            setManagingId(null);
            load();
          } catch (retryErr) {
            setError(retryErr instanceof ApiError ? retryErr.message : 'Failed to delete office');
          }
        }
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to delete office -- it may still have modules or staff accounts');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head">
        <div className="grow">
          <h1>Offices</h1>
        </div>
        <button className="btn btn--primary btn--lg" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} strokeWidth={2.4} />
          Create office
        </button>
      </div>

      {error && (
        <div className="alert danger">
          <div className="body">{error}</div>
        </div>
      )}

      {offices === null && <span className="spinner" />}
      {offices?.length === 0 && <div className="ws-card ws-card--pad" style={{ color: 'var(--t-muted)' }}>No offices yet.</div>}

      {offices && offices.length > 8 && (
        <div className="ws-list-search">
          <Icon name="search" size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${offices.length} offices or programs`} aria-label="Search offices" />
        </div>
      )}

      {offices && offices.length > 0 && (
        <div className="ws-office-grid">
          {offices
            .filter((o) => {
              const t = search.trim().toLowerCase();
              return !t || [o.name, shortName(o.name), o.description ?? '', ...(o.modules ?? []).map((m) => m.name)].some((x) => x.toLowerCase().includes(t));
            })
            .map((o) => {
            const { hue, icon } = officeAppearance(o);
            const short = shortName(o.name);
            return (
              <div key={o.id} className="ws-card ws-office-card" style={{ opacity: o.isActive ? 1 : 0.75 }}>
                <div className="ws-office-head" style={{ background: officeColor(hue, 'soft'), borderBottomColor: officeColor(hue, 'line') }}>
                  <span className="ws-tile" style={{ background: officeColor(hue, 'acc') }}>
                    <Icon name={icon} size={24} strokeWidth={1.8} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: officeColor(hue, 'deep') }}>{short}</div>
                    <div style={{ fontSize: 13, color: 'var(--t-base)' }}>{short !== o.name ? o.name : o.description ?? o.slug}</div>
                  </div>
                  {!o.isActive && <span className="ws-pill ws-pill--muted">Deactivated</span>}
                </div>
                <div className="ws-office-body">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(o.modules ?? []).map((m) => (
                      <span key={m.id} className="ws-pill ws-pill--muted" style={{ color: 'var(--t-base)' }}>{m.name}</span>
                    ))}
                    {o.modules?.length === 0 && <span style={{ fontSize: 13, color: 'var(--t-muted)' }}>No programs yet</span>}
                  </div>
                  <div className="ws-office-stats">
                    <div><strong>{compact(o.recordCount ?? 0)}</strong><span>records</span></div>
                    <div><strong>{compact(o.recordsThisMonth ?? 0)}</strong><span>this month</span></div>
                    <div><strong>{o.activeStaffCount ?? 0}</strong><span>active staff</span></div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                    {onNavigate && (
                      <button type="button" className="btn btn--ghost ws-topbar-btn" onClick={() => onNavigate(`office:${o.id}`)}>Open records</button>
                    )}
                    {onNavigate && (
                      <button type="button" className="btn btn--ghost ws-topbar-btn" onClick={() => onNavigate('settings:staff', o.id)}>Staff</button>
                    )}
                    <button type="button" className="btn btn--ghost ws-topbar-btn" onClick={() => setManagingId(o.id)}>
                      <Icon name="sliders" size={15} />
                      Manage
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <Modal title="Create office" eyebrow="Offices" onClose={() => setCreating(false)}>
          <CreateOfficeForm
            onCreated={() => {
              setCreating(false);
              load();
            }}
          />
        </Modal>
      )}

      {managing && (() => {
        const { hue, icon } = officeAppearance(managing);
        const programs = managing.modules ?? [];
        return (
          <Modal title="Manage office" eyebrow={shortName(managing.name)} onClose={() => { setManagingId(null); setSection(null); }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="mo-head">
                <span className="ws-tile" style={{ background: officeColor(hue, 'acc') }}><Icon name={icon} size={22} strokeWidth={1.8} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 17 }}>{managing.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{managing.isActive ? 'Active' : 'Deactivated'} · {programs.length} {programs.length === 1 ? 'program' : 'programs'}</div>
                </div>
              </div>
              <div className="mo-menu">
                <button type="button" className="mo-item" onClick={() => setSection('details')}>
                  <Icon name="building" size={18} />
                  <span><strong>Office details</strong><span>{[managing.shortName, managing.description].filter(Boolean).join(' · ') || 'Name, short name and description'}</span></span>
                  <Icon name="chevR" size={16} />
                </button>
                <button type="button" className="mo-item" onClick={() => setSection('programs')}>
                  <Icon name="list" size={18} />
                  <span><strong>Programs &amp; forms</strong><span>{programs.map((m) => m.name).join(', ') || 'No programs yet'}</span></span>
                  <Icon name="chevR" size={16} />
                </button>
                <button type="button" className="mo-item" onClick={() => setSection('appearance')}>
                  <span className="mo-swatch" style={{ background: officeColor(hue, 'acc') }}><Icon name={icon} size={12} strokeWidth={2.2} /></span>
                  <span><strong>Color &amp; icon</strong><span>How this office looks in the sidebar and lists</span></span>
                  <Icon name="chevR" size={16} />
                </button>
              </div>
              <div className="mo-status">
                <span style={{ flex: 1, fontSize: 13, color: 'var(--t-muted)' }}>{managing.isActive ? 'Staff of this office can sign in.' : 'This office is switched off.'}</span>
                <button type="button" className="btn btn--ghost ws-topbar-btn" disabled={busyId === managing.id} onClick={() => handleToggleActive(managing)}>
                  {managing.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
                <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ color: 'var(--danger)' }} disabled={busyId === managing.id} onClick={() => handleDelete(managing)}>
                  Delete
                </button>
              </div>
            </div>
            {section === 'details' && (
              <Modal title="Office details" eyebrow={shortName(managing.name)} onClose={() => setSection(null)}>
                <OfficeDetailsEditor key={managing.id} office={managing} onSaved={load} />
              </Modal>
            )}
            {section === 'programs' && (
              <Modal title="Programs & forms" eyebrow={shortName(managing.name)} wide onClose={() => { setSection(null); load(); }}>
                <OfficeModulesSection office={managing} />
              </Modal>
            )}
            {section === 'appearance' && (
              <Modal title="Color & icon" eyebrow={shortName(managing.name)} onClose={() => setSection(null)}>
                <OfficeAppearanceEditor office={managing} offices={offices ?? []} onSaved={() => load()} />
              </Modal>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}


function OfficeDetailsEditor({ office, onSaved }: { office: Office; onSaved: () => void }) {
  const [name, setName] = useState(office.name);
  const [description, setDescription] = useState(office.description ?? '');
  const [short, setShort] = useState(office.shortName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== office.name || description.trim() !== (office.description ?? '') || short.trim() !== (office.shortName ?? '');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.updateOffice(office.id, { name: name.trim(), description: description.trim() || null, shortName: short.trim() || null });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save office details');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="form-grid">
      <div className="field">
        <label className="field-label" htmlFor={`office-name-${office.id}`}>Office name</label>
        <input id={`office-name-${office.id}`} className="input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required maxLength={120} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`office-short-${office.id}`}>Short name</label>
        <input
          id={`office-short-${office.id}`}
          className="input"
          value={short}
          onChange={(e) => { setShort(e.target.value); setSaved(false); }}
          maxLength={20}
          placeholder="e.g. CENRO"
        />
        <span className="field-hint">Shown in the sidebar, cards and charts. Leave empty to use the name.</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`office-slug-${office.id}`}>Module name</label>
        <input id={`office-slug-${office.id}`} className="input mono" value={office.slug} disabled title="The module name is the office's permanent identifier and can't be changed" />
      </div>
      <div className="field span-2">
        <label className="field-label" htmlFor={`office-desc-${office.id}`}>Description</label>
        <input id={`office-desc-${office.id}`} className="input" value={description} onChange={(e) => { setDescription(e.target.value); setSaved(false); }} maxLength={500} />
      </div>
      {error && <div className="field-error span-2">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving || !dirty || !name.trim()}>
          {saving ? 'Saving...' : 'Save details'}
        </button>
        {saved && <span style={{ fontSize: 13, color: 'var(--success)', alignSelf: 'center' }}>Saved</span>}
      </div>
    </form>
  );
}

function OfficeAppearanceEditor({
  office,
  offices,
  onSaved,
}: {
  office: Office;
  offices: Office[];
  onSaved: (updated: Office) => void;
}) {
  const initial = officeAppearance(office);
  const [hue, setHue] = useState(initial.hue);
  const [icon, setIcon] = useState(initial.icon);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedBy: Record<number, string> = {};
  for (const o of offices) if (o.id !== office.id) usedBy[officeAppearance(o).hue] = o.name;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      onSaved(await api.updateOffice(office.id, { accentHue: hue, icon }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update office');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div className="alert danger">
          <div className="body">{error}</div>
        </div>
      )}
      <OfficeAppearancePicker
        hue={hue}
        icon={icon}
        usedBy={usedBy}
        previewName={office.name}
        onChange={(p) => {
          if (p.hue !== undefined) setHue(p.hue);
          if (p.icon) setIcon(p.icon);
        }}
      />
      <div>
        <button type="button" className="btn btn--primary" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving...' : 'Save appearance'}
        </button>
      </div>
    </div>
  );
}

function OfficeModulesSection({ office }: { office: Office }) {
  const [modules, setModules] = useState<OfficeModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<OfficeModule | null>(null);
  const [recordsModule, setRecordsModule] = useState<OfficeModule | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<OfficeModule | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    api
      .listOfficeModules(office.id)
      .then((mods) => {
        setModules(mods);
        setSelectedModule((prev) => mods.find((m) => m.id === prev?.id) ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load modules'));
  }

  useEffect(load, [office.id]);
  const [subject, setSubject] = useState<RecordSubject>('registry');

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugifyPreview(value));
  }

  
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.createOfficeModule(office.id, { name, slug, ...SUBJECT_SETTINGS[subject] });
      setName('');
      setSubject('registry');
      setSlug('');
      setSlugTouched(false);
      load();
      setAdding(false);
      setEditingModule(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create module');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(officeModule: OfficeModule) {
    setError(null);
    setBusyId(officeModule.id);
    try {
      await api.deleteOfficeModule(office.id, officeModule.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove module -- it may already have saved records');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error && (
          <div className="alert danger" style={{ marginBottom: 16 }}>
            <div className="ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
            </div>
            <div className="body">{error}</div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ flex: 1, fontSize: 14, color: 'var(--t-muted)' }}>Each program has its own registration form and records list.</span>
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add program</button>
        </div>

        {modules === null && <span className="spinner" />}
        {modules?.length === 0 && <p style={{ fontSize: 13, color: 'var(--t-muted)' }}>No programs yet.</p>}

        {modules && modules.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Identifier</th>
                  <th>Records are about</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m.id}>
                    <td className="cell-name">{m.name}</td>
                    <td className="mono">{m.slug}</td>
                    <td>
                      {!m.collectPersonInfo ? (
                        <span className="tag t-inactive">Not a person</span>
                      ) : m.requiresCitizenLink ? (
                        <span className="tag t-active">A Vigan resident</span>
                      ) : (
                        <span className="tag t-inactive">A person, link optional</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <IconButton label="Manage fields" icon={FOLDER_ICON} onClick={() => setSelectedModule(m)} />
                        <IconButton label="Configure" icon={GEAR_ICON} onClick={() => setEditingModule(m)} />
                        <IconButton label="View records" icon={EYE_ICON} onClick={() => setRecordsModule(m)} />
                        <IconButton label="Remove" icon={TRASH_ICON} danger disabled={busyId === m.id} onClick={() => handleDelete(m)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {adding && (
        <Modal title="Add program" eyebrow={office.name} onClose={() => setAdding(false)}>
          <form onSubmit={handleCreate} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="module-name">
                Program name
              </label>
              <input id="module-name" className="input" value={name} onChange={(e) => handleNameChange(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="module-slug">
                Identifier
              </label>
              <input
                id="module-slug"
                className="input mono"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                required
              />
            </div>
            <RecordSubjectPicker name="module-subject" value={subject} onChange={setSubject} />
            <div className="field span-2" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn--primary" disabled={creating}>
                {creating ? 'Adding...' : 'Add program'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selectedModule && (
        <Modal
          title="Intake form fields"
          eyebrow={`${office.name} · ${selectedModule.name}`}
          onClose={() => setSelectedModule(null)}
        >
          <ModuleFieldsSection office={office} officeModule={selectedModule} />
        </Modal>
      )}

      {editingModule && (
        <Modal title="Configure module" eyebrow={`${office.name} · ${editingModule.name}`} onClose={() => setEditingModule(null)}>
          <ModuleCoreFieldsEditor
            office={office}
            officeModule={editingModule}
            onSaved={(updated) => {
              setModules((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? prev);
              setEditingModule(updated);
            }}
          />
        </Modal>
      )}

      {recordsModule && (
        <Modal title="Saved records" eyebrow={`${office.name} · ${recordsModule.name}`} onClose={() => setRecordsModule(null)}>
          <OfficeModuleRecordsPanel officeId={office.id} officeModule={recordsModule} />
        </Modal>
      )}
    </>
  );
}


function ModuleCoreFieldsEditor({
  office,
  officeModule,
  onSaved,
}: {
  office: Office;
  officeModule: OfficeModule;
  onSaved: (updated: OfficeModule) => void;
}) {
  const [current, setCurrent] = useState(officeModule);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimeout.current) clearTimeout(savedTimeout.current);
  }, []);

  async function save(key: string, patch: Partial<OfficeModule>) {
    setError(null);
    setSavedKey(null);
    setSavingKey(key);
    if (savedTimeout.current) clearTimeout(savedTimeout.current);
    try {
      const updated = await api.updateOfficeModule(office.id, officeModule.id, patch);
      setCurrent(updated);
      onSaved(updated);
      setSavedKey(key);
      savedTimeout.current = setTimeout(() => setSavedKey(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSavingKey(null);
    }
  }

  
  function saveStatus(key: string) {
    if (savingKey === key) return <span className="spinner sm" style={{ marginLeft: 8 }} />;
    if (savedKey === key) {
      return (
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--success)' }}>Saved</span>
      );
    }
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <label className="check">
        <input
          type="checkbox"
          checked={current.collectPersonInfo}
          disabled={savingKey !== null}
          onChange={(e) => save('collectPersonInfo', { collectPersonInfo: e.target.checked })}
        />
        <span className="box" />
        Collects a person&rsquo;s identity
        {saveStatus('collectPersonInfo')}
      </label>
      {current.collectPersonInfo && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={current.requiresCitizenLink}
              disabled={savingKey !== null}
              onChange={(e) => save('requiresCitizenLink', { requiresCitizenLink: e.target.checked })}
            />
            <span className="box" />
            Requires a Citizen link
            {saveStatus('requiresCitizenLink')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
            <label className="check">
              <input
                type="checkbox"
                checked={current.collectSex}
                disabled={savingKey !== null}
                onChange={(e) => save('collectSex', { collectSex: e.target.checked })}
              />
              <span className="box" />
              Sex
              {saveStatus('collectSex')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={current.collectCivilStatus}
                disabled={savingKey !== null}
                onChange={(e) => save('collectCivilStatus', { collectCivilStatus: e.target.checked })}
              />
              <span className="box" />
              Civil status
              {saveStatus('collectCivilStatus')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={current.collectStreet}
                disabled={savingKey !== null}
                onChange={(e) => save('collectStreet', { collectStreet: e.target.checked })}
              />
              <span className="box" />
              Street
              {saveStatus('collectStreet')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={current.collectBarangay}
                disabled={savingKey !== null}
                onChange={(e) => save('collectBarangay', { collectBarangay: e.target.checked })}
              />
              <span className="box" />
              Barangay
              {saveStatus('collectBarangay')}
            </label>
          </div>
        </>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

function ModuleFieldsSection({ office, officeModule }: { office: Office; officeModule: OfficeModule }) {
  const [fields, setFields] = useState<OfficeFormField[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<OfficeFieldType>('TEXT');
  const [optionsText, setOptionsText] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api
      .listOfficeModuleFields(office.id, officeModule.id)
      .then(setFields)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load fields'));
  }

  useEffect(load, [office.id, officeModule.id]);

  async function handleAddField(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const options = optionsText
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      await api.createOfficeModuleField(office.id, officeModule.id, {
        label,
        fieldType,
        options: fieldType === 'SELECT' || fieldType === 'MULTISELECT' ? options : undefined,
        isRequired,
      });
      setLabel('');
      setFieldType('TEXT');
      setOptionsText('');
      setIsRequired(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add field');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteField(fieldId: string) {
    setError(null);
    setBusyId(fieldId);
    try {
      await api.deleteOfficeModuleField(office.id, officeModule.id, fieldId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove field');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--t-muted)', marginTop: 0, marginBottom: 20 }}>
        Every module form also collects last/first/middle name, birthdate, and address -- these are the extra
        fields specific to {officeModule.name}.
      </p>

      {error && (
        <div className="alert danger" style={{ marginBottom: 16 }}>
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
          </div>
          <div className="body">{error}</div>
        </div>
      )}

      <form onSubmit={handleAddField} className="form-grid" style={{ marginBottom: 20 }}>
        <div className="field">
          <label className="field-label" htmlFor="field-label">
            Field label
          </label>
          <input id="field-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="field-type">
            Field type
          </label>
          <select
            id="field-type"
            className="select"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as OfficeFieldType)}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        {(fieldType === 'SELECT' || fieldType === 'MULTISELECT') && (
          <div className="field span-2">
            <label className="field-label" htmlFor="field-options">
              {fieldType === 'SELECT' ? 'Dropdown' : 'Multi-select'} options (comma-separated)
            </label>
            <input
              id="field-options"
              className="input"
              placeholder="e.g. New, Renewal"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              required
            />
          </div>
        )}
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <label className="check">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            <span className="box" />
            Required
          </label>
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn--primary" disabled={creating}>
            {creating ? 'Adding...' : 'Add field'}
          </button>
        </div>
      </form>

      {fields === null && <span className="spinner" />}
      {fields?.length === 0 && <p style={{ fontSize: 13, color: 'var(--t-muted)' }}>No extra fields yet.</p>}

      {fields && fields.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Options</th>
                <th>Required</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <td className="cell-name">{f.label}</td>
                  <td>{FIELD_TYPE_LABELS[f.fieldType]}</td>
                  <td>{f.options.length > 0 ? f.options.join(', ') : '--'}</td>
                  <td>{f.isRequired ? <span className="tag t-active">Yes</span> : <span className="tag t-inactive">No</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <IconButton label="Remove" icon={TRASH_ICON} danger disabled={busyId === f.id} onClick={() => handleDeleteField(f.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
