import { useEffect, useState } from 'react';
import { api, ApiError, type AppSettings } from '@/lib/api';

// Split out from the combined Settings page -- see StaffAccountsPage.tsx
// for the staff-account management that used to live above this. Not to be
// confused with the Duplicate Review Queue (a separate top-level page for
// resolving individual flagged intakes) -- this page tunes the threshold
// resolvePerson() uses to flag them in the first place.
export function DuplicateMatchingPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="hero">
        <div className="hero-text">
          <h1 className="hero-title">Matching settings</h1>
        </div>
      </div>
      <ThresholdSettingsSection />
    </div>
  );
}

function ThresholdSettingsSection() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [threshold, setThreshold] = useState('');
  const [toleranceDays, setToleranceDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setThreshold(s.FUZZY_MATCH_THRESHOLD);
        setToleranceDays(s.FUZZY_MATCH_BDATE_TOLERANCE_DAYS);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load settings'));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setSaving(true);
    try {
      await Promise.all([
        api.updateSetting('FUZZY_MATCH_THRESHOLD', threshold),
        api.updateSetting('FUZZY_MATCH_BDATE_TOLERANCE_DAYS', toleranceDays),
      ]);
      setSaved('Saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title-wrap">
          <h3 className="card-title">Duplicate-matching thresholds</h3>
          <p className="card-desc">
            Controls how aggressively resolvePerson() treats two intake records as the same citizen. Takes effect
            immediately, no deploy needed.
          </p>
        </div>
      </div>

      {settings === null && !error && <span className="spinner" />}
      {settings && (
        <form onSubmit={handleSave} style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field">
            <label className="field-label" htmlFor="threshold">
              Fuzzy-match threshold (0-1)
            </label>
            <input
              id="threshold"
              type="number"
              min="0"
              max="1"
              step="0.01"
              className="input"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="tolerance">
              Birthdate tolerance (days)
            </label>
            <input
              id="tolerance"
              type="number"
              min="0"
              step="1"
              className="input"
              value={toleranceDays}
              onChange={(e) => setToleranceDays(e.target.value)}
              required
            />
          </div>
          {error && <div className="field-error">{error}</div>}
          {saved && <span className="badge success">{saved}</span>}
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
