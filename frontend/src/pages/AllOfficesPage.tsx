import { useEffect, useRef, useState } from 'react';
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

// Admin self-service for every office -- CSWD/Agriculture/Civil Registry
// included, as of the offices-as-modules unification, not just ones added
// beyond the original three. Each office can have one or more modules
// (most have exactly one; CSWD has three, Civil Registry has two), and
// each module has its own intake form built from a fixed field-type
// palette. See backend/prisma/schema.prisma's comment on the Office model
// for why every office shares one office_staff Postgres role instead of
// its own. Creating an office is a separate page (CreateOfficePage.tsx) --
// this one is purely list + manage, so it doesn't re-fetch/hold create-form
// state it doesn't need.
export function AllOfficesPage({ onNavigate }: { onNavigate?: (tab: AdminTab, filter?: string) => void } = {}) {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
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
      // Every office starts with an empty default module -- that alone
      // shouldn't stop admin from deleting an office they just created by
      // mistake, so offer to remove empty modules along with it.
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

      {managing && (
        <Modal title="Manage office" eyebrow={managing.name} onClose={() => setManagingId(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <section>
              <h3 className="ws-manage-title">Office details</h3>
              <OfficeDetailsEditor key={managing.id} office={managing} onSaved={load} />
            </section>
            <section>
              <h3 className="ws-manage-title">Programs &amp; forms</h3>
              <OfficeModulesSection office={managing} />
            </section>
            <section>
              <h3 className="ws-manage-title">Color &amp; icon</h3>
              <OfficeAppearanceEditor office={managing} offices={offices ?? []} onSaved={() => load()} />
            </section>
            <section>
              <h3 className="ws-manage-title">Status</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--ghost ws-topbar-btn" disabled={busyId === managing.id} onClick={() => handleToggleActive(managing)}>
                  {managing.isActive ? 'Deactivate office' : 'Reactivate office'}
                </button>
                <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ color: 'var(--danger)' }} disabled={busyId === managing.id} onClick={() => handleDelete(managing)}>
                  Delete office
                </button>
              </div>
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Fix the office's name or description (e.g. a typo like "Assesor"). The
// module name / slug stays fixed -- it's the office's stable identifier.
// The backend's audit entry keeps the previous name and description.
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

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugifyPreview(value));
  }

  // Creating only asks for name + identifier -- whether it collects a
  // person's identity, requires a Citizen link, and which optional core
  // fields it gathers are all configured afterward via Edit (see
  // ModuleCoreFieldsEditor), on the module that now exists, instead of
  // being crammed into this one-shot form. New modules start with every
  // one of those defaulted on, same as the backend's own defaults.
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.createOfficeModule(office.id, { name, slug });
      setName('');
      setSlug('');
      setSlugTouched(false);
      load();
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

        <form onSubmit={handleCreate} className="form-grid" style={{ marginBottom: 20 }}>
          <div className="field">
            <label className="field-label" htmlFor="module-name">
              Module name
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
          <div className="field span-2" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn--primary" disabled={creating}>
              {creating ? 'Adding...' : 'Add module'}
            </button>
          </div>
        </form>

        {modules === null && <span className="spinner" />}
        {modules?.length === 0 && <p style={{ fontSize: 13, color: 'var(--t-muted)' }}>No modules yet.</p>}

        {modules && modules.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Identifier</th>
                  <th>Citizen link</th>
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
                        <span className="tag t-inactive">No person info</span>
                      ) : m.requiresCitizenLink ? (
                        <span className="tag t-active">Required</span>
                      ) : (
                        <span className="tag t-inactive">Optional</span>
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

// Toggles which of the optional core intake fields (sex/civil status/
// street/barangay) this module collects -- last/first/middle name and
// birthdate are never optional (resolvePerson() needs them) so they're not
// shown here at all.
//
// Each checkbox saves itself the moment it's clicked -- no separate Save
// button to remember, matching every other toggle in this app (Deactivate/
// Reactivate/Delete all act immediately too). A form with a Save button
// here was a real trap: unchecking a box and then just closing the modal
// (the natural way to "finish") silently discarded the change, which read
// as "this doesn't save at all."
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

  // Small inline status next to whichever checkbox was just touched -- the
  // spinner alone used to vanish with nothing left behind, so there was no
  // way to tell "autosaved" apart from "did nothing."
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
