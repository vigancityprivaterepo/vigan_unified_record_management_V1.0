import { useEffect, useState } from 'react';
import { RecordSubjectPicker, SUBJECT_SETTINGS, type RecordSubject } from '@/components/RecordSubjectPicker';
import { OfficeAppearancePicker } from '@/components/OfficeAppearancePicker';
import { slugifyPreview } from '@/lib/slugify';
import { api, ApiError, type Office } from '@/lib/api';

function shortName(name: string): string {
  return name.replace(/^(City|Municipal)\s+/i, '').split(/\s+/).slice(0, 2).join(' ');
}

export function CreateOfficePage() {
  const [created, setCreated] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="ws-page-head">
        <div className="grow">
          <h1>Create office</h1>
        </div>
      </div>
      {created && (
        <div className="alert success">
          <div className="body">
            &ldquo;{created}&rdquo; created. Go to <strong>Offices</strong> to add programs to it.
          </div>
        </div>
      )}
      <div className="ws-card ws-card--pad">
        <CreateOfficeForm onCreated={(o) => setCreated(o.name)} />
      </div>
    </div>
  );
}

export function CreateOfficeForm({ onCreated }: { onCreated: (office: Office) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hue, setHue] = useState(195);
  const [icon, setIcon] = useState('cross');
  const [usedBy, setUsedBy] = useState<Record<number, string>>({});
  const [subject, setSubject] = useState<RecordSubject>('registry');


  useEffect(() => {
    api
      .listOffices()
      .then((offices) => {
        const map: Record<number, string> = {};
        for (const o of offices) if (o.accentHue !== undefined) map[o.accentHue] = shortName(o.name);
        setUsedBy(map);
      })
      .catch(() => setUsedBy({}));
  }, []);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugifyPreview(value));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const office = await api.createOffice({ name, slug, description: description || undefined, accentHue: hue, icon, ...SUBJECT_SETTINGS[subject] });
      setName('');
      setSlug('');
      setSlugTouched(false);
      setDescription('');
      onCreated(office);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create office');
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="form-grid">
      {error && (
        <div className="alert danger span-2">
          <div className="body">{error}</div>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="office-name">
          Office name
        </label>
        <input id="office-name" className="input" value={name} onChange={(e) => handleNameChange(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="office-slug">
          Identifier (cannot be changed later)
        </label>
        <input
          id="office-slug"
          className="input mono"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          required
        />
      </div>
      <div className="field span-2">
        <label className="field-label" htmlFor="office-description">
          Description (optional)
        </label>
        <input id="office-description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <RecordSubjectPicker name="office-subject" value={subject} onChange={setSubject} />
      <div className="field span-2">
        <OfficeAppearancePicker
          hue={hue}
          icon={icon}
          usedBy={usedBy}
          previewName={name}
          onChange={(p) => {
            if (p.hue !== undefined) setHue(p.hue);
            if (p.icon) setIcon(p.icon);
          }}
        />
      </div>
      <div className="field span-2" style={{ alignItems: 'flex-start' }}>
        <button type="submit" className="btn btn--primary btn--lg" disabled={creating}>
          {creating ? 'Creating...' : 'Create office'}
        </button>
      </div>
    </form>
  );
}
