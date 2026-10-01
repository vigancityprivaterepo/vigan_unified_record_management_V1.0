import { useEffect, useState } from 'react';
import { CitizenPrivacySection } from '@/pages/PrivacyPage';
import { Icon } from '@/components/Icon';
import { OfficeMark } from '@/components/OfficeMark';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import type { AdminTab } from '@/components/shell/AdminSidebar';
import { shortName } from '@/components/shell/OfficeSidebar';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api, ApiError, type Citizen360, type CitizenListItem, type Paginated } from '@/lib/api';
import { initials, moduleIcon, officeColor } from '@/lib/officeTheme';

type OfficeRecord = Citizen360['officeRecords'][number];

function ageOf(bdate: string | null): number | null {
  if (!bdate) return null;
  const b = new Date(bdate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function fullName(p: { personFname: string; personMname: string | null; personLname: string }): string {
  return [p.personFname, p.personMname, p.personLname].filter(Boolean).join(' ');
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
}

// The record's own form values, in form order, as one short line
// ("OSCA-2011-0413 · Social pension"). File uploads are left out.
function recordSummary(r: OfficeRecord): string {
  return r.module.formFields
    .filter((f) => f.fieldType !== 'FILE')
    .map((f) => {
      const v = r.data[f.key];
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'boolean') return v ? f.label : null;
      if (Array.isArray(v)) return v.length ? v.join(', ') : null;
      return String(v);
    })
    .filter((v): v is string => v !== null)
    .slice(0, 3)
    .join(' · ');
}

// Admin's master registry: search list on the left, one citizen's profile
// on the right -- every office's records for them, their household, and
// their (encrypted-at-rest) government IDs.
export function CitizensPage({ initialQuery = '', onNavigate }: { initialQuery?: string; onNavigate?: (tab: AdminTab, filter?: string) => void } = {}) {
  const [query, setQuery] = useState(initialQuery);
  const debouncedQuery = useDebouncedValue(query);
  const [results, setResults] = useState<Paginated<CitizenListItem> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Citizen360 | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runSearch(q: string, p: number) {
    setError(null);
    api
      .searchCitizens(q, p)
      .then((r) => {
        setResults(r);
        // A profile only opens when a name is clicked; a new search closes one
        // that's no longer in the results.
        setSelectedKey((cur) => (cur && r.items.some((c) => c.personKey === cur) ? cur : null));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load citizens'));
  }

  // Live search -- re-fetches once the typed query settles (see useDebouncedValue).
  useEffect(() => {
    runSearch(debouncedQuery, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  function loadCitizen(personKey: string) {
    api
      .citizen360(personKey)
      .then(setSelected)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load citizen'));
  }

  useEffect(() => {
    setSelected(null);
    if (selectedKey) loadCitizen(selectedKey);
  }, [selectedKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head">
        <div className="grow">
          <h1>Citizens</h1>
        </div>
      </div>

      {error && (
        <div className="alert danger">
          <div className="body">{error}</div>
        </div>
      )}

      <div className="ws-card ws-fill-card">
          <form
            style={{ padding: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query, 1);
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--t-muted)' }}>
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search citizens"
                aria-label="Search citizens by last or first name"
                style={{ flex: 1, border: 0, outline: 0, background: 'transparent', font: 'inherit', fontSize: 15, color: 'var(--t-base)' }}
              />
            </div>
          </form>
          <div className="ws-hh-grid">
            {results === null && <div style={{ padding: 18 }}><span className="spinner" /></div>}
            {results?.items.length === 0 && <div style={{ padding: 18, color: 'var(--t-muted)' }}>No matches.</div>}
            {results?.items.map((c) => {
              const age = ageOf(c.personBdate);
              return (
                <button key={c.personKey} type="button" className={`ws-hh-item${c.personKey === selectedKey ? ' is-on' : ''}`} onClick={() => setSelectedKey(c.personKey)}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>
                      {fullName(c)}
                      {c.isArchived && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--t-light)' }}>(merged)</span>}
                    </span>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--t-muted)' }}>
                      {[age !== null ? `${age} yrs` : null, c.barangay?.name].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {/* At most 4 office marks, then a count, so the name keeps its width. */}
                  <span style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 'none' }}>
                    {(c.offices ?? []).slice(0, 4).map((o) => <OfficeMark key={o.id} name={o.name} hue={o.accentHue} icon={o.icon} />)}
                    {(c.offices ?? []).length > 4 && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-muted)' }} title={(c.offices ?? []).slice(4).map((o) => o.name).join(', ')}>
                        +{(c.offices ?? []).length - 4}<span className="sr-only"> more offices</span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {results && results.total > results.pageSize && (
            <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border-soft)' }}>
              <Pagination page={results.page} pageSize={results.pageSize} total={results.total} onPageChange={(p) => runSearch(query, p)} />
            </div>
          )}
      </div>

      {selectedKey && (
        <Modal title="Citizen profile" eyebrow="Citizens" wide onClose={() => setSelectedKey(null)}>
          {!selected && <span className="spinner" />}
          {selected && (
            <CitizenProfile
              data={selected}
              onOpen={setSelectedKey}
              onOpenHousehold={onNavigate ? (key) => onNavigate('households', key) : undefined}
              onUpdated={() => loadCitizen(selectedKey)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function CitizenProfile({ data, onOpen, onOpenHousehold, onUpdated }: {
  data: Citizen360;
  onOpen: (personKey: string) => void;
  onOpenHousehold?: (personKey: string) => void;
  onUpdated: () => void;
}) {
  const { citizen, officeRecords, household } = data;
  const age = ageOf(citizen.personBdate);
  const officeCount = new Set(officeRecords.map((r) => r.module.office.id)).size;
  const facts = [
    age !== null ? `${age} years old` : null,
    citizen.personSex === 'M' ? 'Male' : citizen.personSex === 'F' ? 'Female' : citizen.personSex,
    citizen.personBdate ? `Born ${new Date(citizen.personBdate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : null,
    citizen.barangay ? `Brgy. ${citizen.barangay.name}` : null,
    citizen.personCivilStatus,
  ].filter((f): f is string => !!f);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div className="ws-card ws-card--pad" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <span className="ws-avatar ws-avatar--dark" style={{ width: 64, height: 64, fontSize: 22 }}>{initials(fullName(citizen))}</span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="ws-eyebrow" style={{ color: 'var(--t-muted)', marginBottom: 6 }}>
            In registry since {new Date(citizen.createdAt).getFullYear()}
            {citizen.isArchived ? ' · merged into another record' : ''}
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>{fullName(citizen)}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {facts.map((f) => (
              <span key={f} className="ws-pill ws-pill--muted" style={{ color: 'var(--t-base)' }}>{f}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="ws-card ws-card--pad">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>Records across offices</h2>
          <span style={{ fontSize: 14, color: 'var(--t-muted)' }}>
            {officeRecords.length} record{officeRecords.length === 1 ? '' : 's'} in {officeCount} office{officeCount === 1 ? '' : 's'}
          </span>
        </div>
        {officeRecords.length === 0 && <div style={{ color: 'var(--t-muted)' }}>No office has a record for this person yet.</div>}
        <div className="ws-cz-records">
          {officeRecords.map((r) => {
            const hue = r.module.office.accentHue;
            const summary = recordSummary(r);
            return (
              <div key={r.id} className="ws-cz-record" style={{ background: officeColor(hue, 'soft'), borderColor: officeColor(hue, 'line') }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="ws-tile" style={{ width: 38, height: 38, borderRadius: 'var(--r-md)', background: officeColor(hue, 'acc') }}>
                    <Icon name={moduleIcon(r.module)} size={19} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="ws-eyebrow" style={{ color: officeColor(hue, 'deep'), fontSize: 11 }}>{shortName(r.module.office.name)}</div>
                    <div style={{ fontWeight: 600 }}>{r.module.name}</div>
                  </div>
                </div>
                {summary && <div style={{ fontSize: 14 }}>{summary}</div>}
                <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>Registered {monthYear(r.createdAt)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ws-cz-bottom">
        <div className="ws-card ws-card--pad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>Household</h2>
            {household.length > 0 && onOpenHousehold && (
              <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ height: 36 }} onClick={() => onOpenHousehold(citizen.personKey)}>
                Open household
              </button>
            )}
          </div>
          {household.length === 0 && <div style={{ color: 'var(--t-muted)', fontSize: 14 }}>Not part of a household on file.</div>}
          {household.map((m) => (
            <div key={m.personKey} className="ws-kv-row">
              {m.personKey === citizen.personKey ? (
                <span style={{ fontWeight: 600 }}>{fullName(m)}</span>
              ) : (
                <button type="button" className="ws-link" onClick={() => onOpen(m.personKey)}>{fullName(m)}</button>
              )}
              <span style={{ color: 'var(--t-muted)' }}>{m.personIsHead ? 'Head of household' : m.personRelationToHead ?? 'Member'}</span>
            </div>
          ))}
        </div>
        <GovernmentIdsSection
          key={citizen.personKey}
          personKey={citizen.personKey}
          sss={citizen.sss}
          gsis={citizen.gsis}
          philhealth={citizen.philhealth}
          onUpdated={onUpdated}
        />
      </div>
      <CitizenPrivacySection personKey={citizen.personKey} name={fullName(citizen)} />
    </div>
  );
}

// "01-2345678-9" -> "••-•••••••-9": keeps separators and the last character.
function maskId(value: string): string {
  return value.replace(/[A-Za-z0-9]/g, (ch, i: number) => (i === value.length - 1 ? ch : '•'));
}

// Encrypted at rest (backend/src/lib/encryption.ts) -- decrypted only for
// this admin-only view, and masked by default here too since it's still
// sensitive to have visible on a shared screen even for an authorized viewer.
function GovernmentIdsSection({
  personKey,
  sss,
  gsis,
  philhealth,
  onUpdated,
}: {
  personKey: string;
  sss: string | null;
  gsis: string | null;
  philhealth: string | null;
  onUpdated: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ sss: sss ?? '', gsis: gsis ?? '', philhealth: philhealth ?? '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, string> = {};
      if (form.sss) patch.sss = form.sss;
      if (form.gsis) patch.gsis = form.gsis;
      if (form.philhealth) patch.philhealth = form.philhealth;
      await api.updateGovernmentIds(personKey, patch);
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const rows: Array<[string, string | null]> = [
    ['SSS', sss],
    ['PhilHealth', philhealth],
    ['GSIS', gsis],
  ];

  return (
    <div className="ws-card ws-card--pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>Government IDs</h2>
        {!editing && (
          <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ height: 36 }} onClick={() => setRevealed((r) => !r)}>
            {revealed ? 'Hide' : 'Reveal'}
          </button>
        )}
        <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ height: 36 }} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {!editing &&
        rows.map(([label, value]) => (
          <div key={label} className="ws-kv-row">
            <span style={{ color: 'var(--t-muted)' }}>{label}</span>
            <span className="mono" style={{ fontWeight: 600 }}>{value ? (revealed ? value : maskId(value)) : 'Not on file'}</span>
          </div>
        ))}

      {editing && (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(['sss', 'philhealth', 'gsis'] as const).map((k) => (
            <div key={k} className="field">
              <label className="field-label" htmlFor={`gov-${k}`}>{k === 'sss' ? 'SSS' : k === 'gsis' ? 'GSIS' : 'PhilHealth'}</label>
              <input id={`gov-${k}`} className="input mono" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
            </div>
          ))}
          {error && <div className="field-error">{error}</div>}
          <button type="submit" className="btn btn--primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}
    </div>
  );
}
