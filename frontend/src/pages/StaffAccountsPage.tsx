import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { OfficePicker } from '@/components/OfficePicker';
import { shortName } from '@/components/shell/OfficeSidebar';
import { EDIT_ICON, TRASH_ICON } from '@/lib/actionIcons';
import { api, ApiError, type Office, type StaffAccount, type StaffRole } from '@/lib/api';
import { ADMIN_HUE, MONOCHROME, initials, officeAppearance, officeColor } from '@/lib/officeTheme';

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Administrator',
  office_staff: 'Office staff',
};

const CREATABLE_ROLES: StaffRole[] = ['admin', 'office_staff'];

// Suggestions only -- the Position field is free text, so any title works.
const POSITION_SUGGESTIONS = [
  'Social Welfare Aide',
  'Social Welfare Assistant',
  'Social Welfare Officer I',
  'Social Welfare Officer II',
  'Social Welfare Officer III',
  'Administrative Aide I',
  'Administrative Aide IV',
  'Administrative Assistant I',
  'Administrative Assistant II',
  'Administrative Officer I',
  'Records Officer I',
  'Records Administrator',
  'Registration Officer I',
  'Agricultural Technologist',
  'Nurse I',
  'Midwife I',
  'Sanitary Inspector I',
  'Revenue Collection Clerk I',
  'Assessment Clerk I',
  'Licensing Officer I',
  'Engineer I',
  'Planning Officer I',
  'Tourism Operations Officer I',
  'Veterinarian I',
  'Environmental Management Specialist I',
  'Labor and Employment Officer I',
  'Disaster Risk Reduction Officer I',
  'City Department Head',
  'System Administrator',
];

function PositionInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} list={`${id}-list`} maxLength={120} placeholder="e.g. Social Welfare Aide" />
      <datalist id={`${id}-list`}>
        {POSITION_SUGGESTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </>
  );
}

// "Today, 8:05 AM" / "Yesterday, 4:40 PM" / "12 Aug 2026" / "Never"
function formatSignIn(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

type Filter = 'all' | 'admin' | string; // string = an office id

// Staff table with office filter chips. initialQuery is an office id when
// arriving from an office card's "Staff" button.
export function StaffAccountsPage({ initialQuery }: { initialQuery?: string } = {}) {
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null);
  const [offices, setOffices] = useState<Office[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(initialQuery || 'all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [resetTarget, setResetTarget] = useState<StaffAccount | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const [editTarget, setEditTarget] = useState<StaffAccount | null>(null);

  function load() {
    api
      .staffAccounts()
      .then(setAccounts)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load staff accounts'));
  }

  useEffect(load, []);
  useEffect(() => {
    api.listOffices().then(setOffices).catch((err) => {
      setOffices([]);
      setError(`Couldn't load the office list (${err instanceof ApiError ? err.message : 'server not reachable'}). Office names and filters may be missing; reload to try again.`);
    });
  }, []);

  async function handleToggleActive(account: StaffAccount) {
    setError(null);
    setBusyId(account.id);
    try {
      const updated = account.isActive ? await api.deactivateStaffAccount(account.id) : await api.reactivateStaffAccount(account.id);
      setAccounts((prev) => prev?.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update account');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(account: StaffAccount) {
    if (!window.confirm(`Permanently delete "${account.username}"? This cannot be undone.`)) return;
    setError(null);
    setBusyId(account.id);
    try {
      await api.deleteStaffAccount(account.id);
      setAccounts((prev) => prev?.filter((a) => a.id !== account.id) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete account');
    } finally {
      setBusyId(null);
    }
  }

  function openResetPassword(account: StaffAccount) {
    setResetTarget(account);
    setResetPassword('');
    setResetError(null);
  }

  async function handleConfirmReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetting(true);
    try {
      await api.resetStaffAccountPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  }

  const officeById = new Map(offices.map((o) => [o.id, o]));
  const hueOf = (a: StaffAccount) => (a.role === 'admin' ? ADMIN_HUE : officeAppearance(officeById.get(a.officeId ?? '') ?? null).hue);
  const chips: Array<{ key: Filter; label: string; count: number }> = accounts
    ? [
        { key: 'all', label: 'All offices', count: accounts.length },
        ...offices
          .map((o) => ({ key: o.id, label: shortName(o.name), count: accounts.filter((a) => a.officeId === o.id).length }))
          .filter((c) => c.count > 0 || c.key === filter || offices.length > 8),
        { key: 'admin', label: 'Administrators', count: accounts.filter((a) => a.role === 'admin').length },
      ]
    : [];
  const shown = (accounts ?? []).filter((a) => (filter === 'all' ? true : filter === 'admin' ? a.role === 'admin' : a.officeId === filter));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ws-page-head">
        <div className="grow">
          <h1>Staff accounts</h1>
        </div>
        <button className="btn btn--primary btn--lg" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} strokeWidth={2.4} />
          Add staff account
        </button>
      </div>

      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Past 8 offices the per-office chips become one searchable dropdown. */}
          {(chips.length - 2 > 8 ? [chips[0]!, chips[chips.length - 1]!] : chips).map((c) => (
            <button key={c.key} type="button" className={`ws-chip${filter === c.key ? ' is-on' : ''}`} onClick={() => setFilter(c.key)}>
              {c.label} · {c.count}
            </button>
          ))}
          {chips.length - 2 > 8 && (
            <OfficePicker
              options={chips
                .slice(1, -1)
                .map((c) => ({ key: c.key, label: c.label, count: c.count, hue: officeAppearance(officeById.get(c.key) ?? null).hue }))
                .sort((a, b) => a.label.localeCompare(b.label))}
              value={filter === 'all' || filter === 'admin' ? null : filter}
              onChange={setFilter}
            />
          )}
        </div>
      )}

      {error && (
        <div className="alert danger">
          <div className="body">{error}</div>
        </div>
      )}

      {accounts === null && <span className="spinner" />}
      {accounts && (
        <div className="ws-card" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="table ws-staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Office</th>
                  <th>Position / role</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--t-muted)' }}>No accounts here.</td>
                  </tr>
                )}
                {shown.map((a) => {
                  const hue = hueOf(a);
                  const office = a.officeId ? officeById.get(a.officeId) : undefined;
                  return (
                    <tr key={a.id}>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span className="ws-avatar" style={{ background: a.isActive ? (MONOCHROME ? 'var(--primary)' : officeColor(hue, 'acc')) : 'var(--bg-muted)', color: a.isActive ? '#fff' : 'var(--t-muted)' }}>
                            {initials(a.fullName)}
                          </span>
                          <span>
                            <span style={{ display: 'block', fontWeight: 600 }}>{a.fullName}</span>
                            <span className="mono" style={{ fontSize: 12, color: 'var(--t-muted)' }}>{a.username}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="ws-office-chip" style={{ background: officeColor(hue, 'soft'), color: officeColor(hue, 'deep'), borderColor: officeColor(hue, 'line') }}>
                          {a.role === 'admin' ? 'Administrator' : office ? shortName(office.name) : 'No office'}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'block' }}>{a.position || ROLE_LABELS[a.role]}</span>
                        {a.position && <span style={{ fontSize: 12, color: 'var(--t-muted)' }}>{ROLE_LABELS[a.role]}</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatSignIn(a.lastSignInAt)}</td>
                      <td>
                        <span className={`ws-pill ${a.isActive ? 'ws-pill--linked' : 'ws-pill--muted'}`}>{a.isActive ? 'Active' : 'Deactivated'}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button type="button" className="btn btn--ghost ws-topbar-btn" style={{ height: 36 }} disabled={busyId === a.id} onClick={() => openResetPassword(a)}>
                            Reset password
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost ws-topbar-btn"
                            style={{ height: 36, color: a.isActive ? 'var(--danger)' : 'var(--success)' }}
                            disabled={busyId === a.id}
                            onClick={() => handleToggleActive(a)}
                          >
                            {a.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                          <IconButton label="Edit" icon={EDIT_ICON} disabled={busyId === a.id} onClick={() => setEditTarget(a)} />
                          <IconButton label="Delete" icon={TRASH_ICON} danger disabled={busyId === a.id} onClick={() => handleDelete(a)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adding && (
        <Modal title="Add staff account" eyebrow="Staff accounts" onClose={() => setAdding(false)}>
          <AddAccountForm
            offices={offices}
            defaultOfficeId={filter !== 'all' && filter !== 'admin' ? filter : ''}
            onCreated={load}
            onDone={() => setAdding(false)}
          />
        </Modal>
      )}

      {resetTarget && (
        <Modal title="Reset password" eyebrow={resetTarget.username} onClose={() => setResetTarget(null)}>
          <form onSubmit={handleConfirmReset} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <label className="field-label" htmlFor="reset-password">
                New password
              </label>
              <input
                id="reset-password"
                type="text"
                className="input mono"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                minLength={8}
                required
                autoFocus
              />
            </div>
            {resetError && <div className="field-error">{resetError}</div>}
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={resetting}>
                {resetting ? 'Saving...' : 'Set password'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setResetTarget(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit staff account" eyebrow={editTarget.username} onClose={() => setEditTarget(null)}>
          <EditAccountForm
            account={editTarget}
            offices={offices}
            onSaved={(updated) => {
              setAccounts((prev) => prev?.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)) ?? prev);
              setEditTarget(null);
            }}
            onCancel={() => setEditTarget(null)}
          />
        </Modal>
      )}
    </div>
  );
}

// Create form for the popup. After saving, the popup switches to showing the
// account's password once -- it's never stored or shown again.
function AddAccountForm({
  offices,
  defaultOfficeId,
  onCreated,
  onDone,
}: {
  offices: Office[];
  defaultOfficeId: string;
  onCreated: () => void;
  onDone: () => void;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [role, setRole] = useState<StaffRole>('office_staff');
  const [officeId, setOfficeId] = useState(defaultOfficeId);
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ username: string; password: string } | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const { account, oneTimePassword } = await api.createStaffAccount({
        username,
        fullName,
        position: position.trim() || undefined,
        role,
        officeId: role === 'office_staff' ? officeId : undefined,
        password: password || undefined,
      });
      setRevealed({ username: account.username, password: oneTimePassword });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create account');
    } finally {
      setCreating(false);
    }
  }

  if (revealed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="alert warning">
          <div className="body">
            <div className="title">
              Password for <span className="mono">{revealed.username}</span>
            </div>
            <div className="mono" style={{ fontSize: 15, wordBreak: 'break-all', marginTop: 4 }}>{revealed.password}</div>
            <p style={{ fontSize: 12, color: 'var(--t-muted)', marginTop: 6 }}>
              Give this to the staff member directly. It won’t be shown again and isn’t stored anywhere.
            </p>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleCreate} className="form-grid">
      <div className="field">
        <label className="field-label" htmlFor="new-fullname">Full name</label>
        <input id="new-fullname" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="new-position">Position / title</label>
        <PositionInput id="new-position" value={position} onChange={setPosition} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="new-username">Username</label>
        <input id="new-username" className="input mono" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="new-role">Role</label>
        <select id="new-role" className="select" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {CREATABLE_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </div>
      {role === 'office_staff' && (
        <div className="field">
          <label className="field-label" htmlFor="new-office">Office</label>
          <select id="new-office" className="select" value={officeId} onChange={(e) => setOfficeId(e.target.value)} required>
            <option value="" disabled>{offices.length === 0 ? 'No offices yet. Create one first.' : 'Select office'}</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field span-2">
        <label className="field-label" htmlFor="new-password">Password</label>
        <input
          id="new-password"
          type="text"
          className="input mono"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank to auto-generate"
          minLength={8}
        />
      </div>
      {error && <div className="field-error span-2">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={creating || (role === 'office_staff' && !officeId)}>
          {creating ? 'Creating...' : 'Create account'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

// Username isn't editable here (it's the login identifier -- see the
// backend route's own comment on why that's a bigger operation than this
// form implies).
function EditAccountForm({
  account,
  offices,
  onSaved,
  onCancel,
}: {
  account: StaffAccount;
  offices: Office[];
  onSaved: (updated: StaffAccount) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(account.fullName);
  const [position, setPosition] = useState(account.position ?? '');
  const [role, setRole] = useState<StaffRole>(account.role);
  const [officeId, setOfficeId] = useState(account.officeId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await api.updateStaffAccount(account.id, {
        fullName,
        position: position.trim() || null,
        role,
        officeId: role === 'office_staff' ? officeId : null,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      <div className="field">
        <label className="field-label" htmlFor="edit-fullname">
          Full name
        </label>
        <input id="edit-fullname" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="edit-position">
          Position / title
        </label>
        <PositionInput id="edit-position" value={position} onChange={setPosition} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="edit-role">
          Role
        </label>
        <select id="edit-role" className="select" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {CREATABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      {role === 'office_staff' && (
        <div className="field span-2">
          <label className="field-label" htmlFor="edit-office">
            Office
          </label>
          <select id="edit-office" className="select" value={officeId} onChange={(e) => setOfficeId(e.target.value)} required>
            <option value="" disabled>
              {offices.length === 0 ? 'No offices yet. Create one first.' : 'Select office'}
            </option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <div className="field-error" style={{ gridColumn: 'span 2' }}>
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving || (role === 'office_staff' && !officeId)}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
