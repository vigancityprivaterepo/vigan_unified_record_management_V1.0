import { useEffect, useState } from 'react';
import { CitizenPicker } from '@/components/CitizenPicker';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { shortName } from '@/components/shell/OfficeSidebar';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { X_ICON } from '@/lib/actionIcons';
import {
  api,
  ApiError,
  type CitizenListItem,
  type HouseholdDetail,
  type HouseholdListItem,
  type HouseholdMember,
  type HouseholdProfile,
  type HouseholdProfileField,
  type Paginated,
  type PersonCategory,
} from '@/lib/api';
import { initials, officeColor } from '@/lib/officeTheme';

const SENIOR_AGE = 60;

// Admin's roster-wide search (paginated on its own page) -- CitizenPicker
// just wants a flat list of matches for a picker, so the first page is
// plenty.
function searchCitizensForPicker(q: string) {
  return api.searchCitizens(q, 1).then((r) => r.items);
}

function ageOf(bdate: string | null): number | null {
  if (!bdate) return null;
  const b = new Date(bdate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function fullName(m: Pick<HouseholdMember, 'personFname' | 'personMname' | 'personLname'>): string {
  return [m.personFname, m.personMname, m.personLname].filter(Boolean).join(' ');
}

// One chip per office (a person in two CSWD programs shows CSWD once).
function officeChips(categories: PersonCategory[]) {
  const seen = new Map<string, PersonCategory>();
  for (const c of categories) if (!seen.has(c.officeId)) seen.set(c.officeId, c);
  return [...seen.values()];
}

// Master-detail: household list on the left, the selected household's
// summary and indented family tree on the right. Create / add member /
// remove member / disband all work as before.
const PERSON_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// initialQuery: a name from the top-bar search, or a person_key when a
// citizen's profile links here ("Open household").
export function HouseholdsPage({ initialQuery = '' }: { initialQuery?: string } = {}) {
  const [query, setQuery] = useState(PERSON_KEY.test(initialQuery) ? '' : initialQuery);
  // Jumping in from a profile searches by key once; typing replaces it.
  const [keyFilter, setKeyFilter] = useState(PERSON_KEY.test(initialQuery) ? initialQuery : '');
  const debouncedQuery = useDebouncedValue(query.trim());
  const search = keyFilter || debouncedQuery;
  const [page, setPage] = useState(1);
  const [households, setHouseholds] = useState<Paginated<HouseholdListItem> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function load(p: number, keepSelection = true) {
    setPage(p);
    api
      .households(p, search || undefined)
      .then((res) => {
        setHouseholds(res);
        // Nothing opens until a household is clicked -- except arriving from a
        // citizen's profile ("Open household"), which opens it straight away.
        setSelectedKey((cur) =>
          keepSelection && cur && res.items.some((h) => h.personKey === cur) ? cur : keyFilter ? res.items[0]?.personKey ?? null : null,
        );
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load households'));
  }

  useEffect(() => {
    load(1, !search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function loadDetail(personKey: string) {
    api
      .household(personKey)
      .then(setDetail)
      .catch((err) => {
        setDetail(null);
        setError(err instanceof ApiError ? err.message : 'Failed to load household');
      });
  }

  useEffect(() => {
    setDetail(null);
    if (selectedKey) loadDetail(selectedKey);
  }, [selectedKey]);

  async function handleCreateHousehold(citizen: CitizenListItem) {
    setError(null);
    try {
      await api.createHousehold(citizen.personKey);
      setCreating(false);
      setSelectedKey(citizen.personKey);
      load(page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create household');
    }
  }

  const selected = households?.items.find((h) => h.personKey === selectedKey) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head">
        <div className="grow">
          <h1>Households</h1>
        </div>
        <button className="btn btn--primary btn--lg" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} strokeWidth={2.4} />
          Create household
        </button>
      </div>

      {error && (
        <div className="alert danger">
          <div className="body">{error}</div>
        </div>
      )}

      {creating && (
        <Modal title="Create household" eyebrow="Households" onClose={() => setCreating(false)}>
          <div style={{ fontSize: 13, color: 'var(--t-muted)', marginBottom: 12 }}>Pick an existing citizen to be the household head.</div>
          <CitizenPicker search={searchCitizensForPicker} onSelect={handleCreateHousehold} placeholder="Search for the household head..." />
        </Modal>
      )}

      {households === null && <span className="spinner" />}

      {households && (
        <div className="ws-card ws-fill-card">
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--t-muted)' }}>
                <Icon name="search" size={16} />
                <input
                  value={query}
                  onChange={(e) => {
                    setKeyFilter('');
                    setQuery(e.target.value);
                  }}
                  placeholder="Search head or member name"
                  aria-label="Search households by head or member name"
                  style={{ flex: 1, border: 0, outline: 0, background: 'transparent', font: 'inherit', fontSize: 15, color: 'var(--t-base)' }}
                />
                {(query || keyFilter) && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery('');
                      setKeyFilter('');
                    }}
                    style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--t-muted)', display: 'grid' }}
                  >
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="ws-eyebrow" style={{ padding: '0 18px 10px', color: 'var(--t-muted)' }}>
              {households.total.toLocaleString()} household{households.total === 1 ? '' : 's'}
              {keyFilter ? ' · for the selected citizen' : search ? ` · matching “${search}”` : ''}
            </div>
            {households.items.length === 0 && (

              <div style={{ padding: '4px 18px 18px', color: 'var(--t-muted)', fontSize: 14 }}>
                {search ? 'No household has a head or member with that name.' : 'No households on file yet.'}
              </div>
            )}
            <div className="ws-hh-grid">
            {households.items.map((h) => (
              <button
                key={h.personKey}
                type="button"
                className={`ws-hh-item${h.personKey === selectedKey ? ' is-on' : ''}`}
                onClick={() => setSelectedKey(h.personKey)}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{h.personLname} household</span>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--t-muted)' }}>
                    {[h.barangayName ? `Brgy. ${h.barangayName}` : null, `${h.personFname} ${h.personLname}`].filter(Boolean).join(' · ')}
                  </span>
                  {h.matchedMembers && h.matchedMembers.length > 0 && (
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
                      Includes {h.matchedMembers.join(', ')}
                    </span>
                  )}
                </span>
                <span className="ws-hh-count">{h.memberCount}</span>
              </button>
            ))}
            </div>
            {households.total > households.pageSize && (
              <div style={{ padding: '8px 12px' }}>
                <Pagination page={households.page} pageSize={households.pageSize} total={households.total} onPageChange={(p) => load(p, false)} />
              </div>
            )}
        </div>
      )}

      {selected && (
        <Modal title={`${selected.personLname} household`} eyebrow="Households" wide onClose={() => setSelectedKey(null)}>
          <HouseholdPanel
            key={selected.personKey}
            household={selected}
            detail={detail}
            onChanged={() => {
              loadDetail(selected.personKey);
              load(page);
            }}
            onDisbanded={() => {
              setSelectedKey(null);
              load(page, false);
            }}
            onError={setError}
          />
        </Modal>
      )}
    </div>
  );
}

const niceDay = (day: string) => new Date(`${day}T00:00`).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' });

// The household's water, toilet, electricity and housing: the items CBMS
// records per household. The questions and their answers come from the server.
// Edited in a pop-up, like Add member.
function LivingConditions({
  headPersonKey,
  householdName,
  profile,
  fields,
  onSaved,
  onError,
}: {
  headPersonKey: string;
  householdName: string;
  profile: HouseholdProfile | null;
  fields: HouseholdProfileField[];
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string | null> | null>(null);
  const [saving, setSaving] = useState(false);
  const answered = fields.filter((f) => profile?.values[f.key]).length;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await api.saveHouseholdProfile(headPersonKey, draft);
      setDraft(null);
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to save living conditions');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Living conditions</h2>
          {profile && answered > 0 && (
            <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>
              {profile.source === 'cbms' ? `From CBMS, as of ${niceDay(profile.asOf)}` : `Recorded ${niceDay(profile.asOf)}`}
            </div>
          )}
        </div>
        {!draft && (
          <button
            type="button"
            className="btn btn--ghost ws-topbar-btn"
            style={{ height: 36 }}
            onClick={() => setDraft(Object.fromEntries(fields.map((f) => [f.key, profile?.values[f.key] ?? null])))}
          >
            {answered === 0 && <Icon name="plus" size={15} />}
            {answered > 0 ? 'Edit' : 'Record'}
          </button>
        )}
      </div>

      {!draft && answered === 0 && <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>Not recorded yet.</div>}

      {!draft && answered > 0 && (
        <div className="ws-hh-profile">
          {fields.map((f) => {
            const value = profile?.values[f.key];
            return (
              <div key={f.key}>
                <span>{f.label}</span>
                <strong className={value ? undefined : 'is-empty'}>{value ? f.options.find((o) => o.value === value)?.label ?? value : 'Not recorded'}</strong>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <Modal title="Living conditions" eyebrow={householdName} wide onClose={() => !saving && setDraft(null)}>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="ws-hh-profile-form">
              {fields.map((f) => (
                <div key={f.key} className="field">
                  <label className="field-label" htmlFor={`hh-${f.key}`}>{f.label}</label>
                  <select id={`hh-${f.key}`} className="select" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value || null })}>
                    <option value="">Not recorded</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function HouseholdPanel({
  household,
  detail,
  onChanged,
  onDisbanded,
  onError,
}: {
  household: HouseholdListItem;
  detail: HouseholdDetail | null;
  onChanged: () => void;
  onDisbanded: () => void;
  onError: (message: string) => void;
}) {
  const [addingMember, setAddingMember] = useState(false);
  const [busyPersonKey, setBusyPersonKey] = useState<string | null>(null);
  const [disbanding, setDisbanding] = useState(false);

  async function handleAddMember(citizen: CitizenListItem) {
    const relation = window.prompt(`How is ${citizen.personFname} ${citizen.personLname} related to the head?`, 'Child');
    if (relation === null) return;
    if (relation.trim().length === 0) {
      window.alert('A relation is required.');
      return;
    }
    try {
      await api.addHouseholdMember(household.personKey, citizen.personKey, relation.trim());
      setAddingMember(false);
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to add member');
    }
  }

  async function handleRemoveMember(member: HouseholdMember) {
    if (!window.confirm(`Remove ${member.personFname} ${member.personLname} from this household?`)) return;
    setBusyPersonKey(member.personKey);
    try {
      await api.removeHouseholdMember(household.personKey, member.personKey);
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to remove member');
    } finally {
      setBusyPersonKey(null);
    }
  }

  async function handleDisband() {
    if (!window.confirm(`Disband the ${household.personLname} household? The head stays on file, just no longer a household head.`)) return;
    setDisbanding(true);
    try {
      await api.disbandHousehold(household.personKey);
      onDisbanded();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to disband household');
    } finally {
      setDisbanding(false);
    }
  }

  if (!detail) {
    return <div className="ws-card ws-card--pad"><span className="spinner" /></div>;
  }

  const everyone = [detail.head, ...detail.members];
  const subHeadKeys = new Set(detail.members.map((m) => m.personSubParentKey).filter((k): k is string => k !== null));
  const seniors = everyone.filter((m) => (ageOf(m.personBdate) ?? 0) >= SENIOR_AGE).length;
  const offices = new Set(everyone.flatMap((m) => m.categories.map((c) => c.officeId))).size;
  const direct = detail.members.filter((m) => !m.personSubParentKey || !detail.members.some((x) => x.personKey === m.personSubParentKey));
  const nestedUnder = (key: string) => detail.members.filter((m) => m.personSubParentKey === key);
  const headName = fullName(detail.head);

  const row = (m: HouseholdMember, depth: number, isHead = false) => {
    const age = ageOf(m.personBdate);
    const isSubHead = subHeadKeys.has(m.personKey);
    const sub = [isHead ? 'Head of household' : m.personRelationToHead ?? 'Member', age !== null ? `${age} yrs` : null].filter(Boolean).join(' · ');
    return (
      <div key={m.personKey} className={`ws-tree-row${depth > 0 && (isSubHead || depth > 1) ? ' is-branch' : ''}`} style={{ marginLeft: depth === 0 ? 0 : depth === 1 ? 26 : 60 }}>
        {depth > 0 && <span className="ws-tree-elbow" aria-hidden="true" />}
        <span className={`ws-avatar${isHead ? ' ws-avatar--dark' : ''}`}>{initials(fullName(m))}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontWeight: 600 }}>
            {fullName(m)}
            {isSubHead && <span className="ws-tag-dark">Sub-household head</span>}
          </span>
          <span style={{ display: 'block', fontSize: 13, color: 'var(--t-muted)' }}>{sub}</span>
        </span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {officeChips(m.categories).map((c) => (
            <span key={c.officeId} className="ws-office-chip"
              style={{ background: officeColor(c.accentHue, 'soft'), color: officeColor(c.accentHue, 'deep'), borderColor: officeColor(c.accentHue, 'line') }}>
              {shortName(c.officeName)}
            </span>
          ))}
        </span>
        {isHead ? (
          <IconButton
            label={detail.members.length > 0 ? 'Disband (remove every member first)' : 'Disband household'}
            icon={X_ICON}
            danger
            disabled={disbanding || detail.members.length > 0}
            onClick={handleDisband}
          />
        ) : (
          <IconButton label="Remove from household" icon={X_ICON} danger disabled={busyPersonKey === m.personKey} onClick={() => handleRemoveMember(m)} />
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="ws-tile ws-tile--lg" style={{ background: '#1B2230' }}><Icon name="home" size={24} /></span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{household.personLname} household</div>
            <div style={{ color: 'var(--t-muted)' }}>
              {[detail.head.barangayName ? `Barangay ${detail.head.barangayName}` : null, `Head: ${headName}`].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        <div className="ws-hh-stats">
          <div><strong>{everyone.length}</strong><span>Members</span></div>
          <div><strong>{seniors}</strong><span>Senior citizens</span></div>
          <div><strong>{subHeadKeys.size}</strong><span>Sub-households</span></div>
          <div><strong>{offices}</strong><span>Offices serving</span></div>
        </div>
      </div>

      <LivingConditions headPersonKey={household.personKey} householdName={`${household.personLname} household`} profile={detail.profile} fields={detail.profileFields} onSaved={onChanged} onError={onError} />

      {detail.assistance.length > 0 && (
        <div className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Assistance received</h2>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Date</th><th>Program</th><th>Given to</th><th className="as-num">Value</th></tr></thead>
              <tbody>
                {detail.assistance.map((a) => (
                  <tr key={a.recordId}>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.on}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.program}</div>
                      <div style={{ fontSize: 13, color: 'var(--t-muted)' }}>{a.office}</div>
                    </td>
                    <td>{a.recipient}</td>
                    <td className="as-num">{a.amount === null ? '' : `₱${a.amount.toLocaleString('en-PH')}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="ws-card ws-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>Family tree</h2>
          <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ height: 36 }} onClick={() => setAddingMember(true)}>
            <Icon name="plus" size={15} />
            Add member
          </button>
        </div>
        {addingMember && (
          <Modal title="Add member" eyebrow={`${household.personLname} household`} onClose={() => setAddingMember(false)}>
            <div style={{ fontSize: 13, color: 'var(--t-muted)', marginBottom: 12 }}>Pick an existing citizen. You’ll be asked how they’re related to the head.</div>
            <CitizenPicker search={searchCitizensForPicker} onSelect={handleAddMember} excludePersonKey={household.personKey} placeholder="Search for a member..." />
          </Modal>
        )}
        {row(detail.head, 0, true)}
        {direct.map((m) => [row(m, 1), ...nestedUnder(m.personKey).map((n) => row(n, 2))])}
        {detail.members.length === 0 && <div style={{ fontSize: 13, color: 'var(--t-muted)', padding: '4px 0' }}>No members yet. Use Add member to build the household.</div>}
      </div>
    </div>
  );
}
