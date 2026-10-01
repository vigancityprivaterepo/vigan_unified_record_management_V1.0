import { useEffect, useState } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ApiError, type CitizenListItem } from '@/lib/api';

// Search-and-pick widget for "link this existing citizen" flows -- used by
// the Households page (admin) to choose a household head or a member, and
// by an office's own intake form (e.g. Civil Registry's Birth module) to
// link a newborn into a parent's household. Never creates a citizen; only
// searches ones already on file. Takes `search` rather than calling a
// fixed endpoint itself -- admin's roster search (/admin/citizens) and an
// office's own scoped search (/offices/:officeId/citizen-search) are
// different backend routes with different access grants, so the caller
// decides which one applies.
export function CitizenPicker({
  search,
  onSelect,
  excludePersonKey,
  placeholder,
}: {
  search: (q: string) => Promise<CitizenListItem[]>;
  onSelect: (citizen: CitizenListItem) => void;
  excludePersonKey?: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [results, setResults] = useState<CitizenListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(text: string) {
    setError(null);
    try {
      const items = await search(text);
      setResults(items.filter((c) => c.personKey !== excludePersonKey));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed');
    }
  }

  // Live search once the query settles -- but only once something's been
  // typed. Unlike Citizens/Records, this picker starts with no results
  // shown at all rather than previewing the full roster, since it's
  // embedded inline inside another form.
  useEffect(() => {
    if (!debouncedQ.trim()) {
      setResults(null);
      return;
    }
    runSearch(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  function handleSearch(e: React.FormEvent) {
    // Submitting jumps the search immediately instead of waiting out the
    // debounce -- live search above still covers typing-and-pausing.
    e.preventDefault();
    if (q.trim()) runSearch(q);
  }

  return (
    <div>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          placeholder={placeholder ?? 'Search last or first name...'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn btn--ghost btn--sm" style={{ flexShrink: 0 }}>
          Search
        </button>
      </form>

      {error && (
        <div className="field-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}

      {results && (
        <ul style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {results.length === 0 && <li style={{ fontSize: 12.5, color: 'var(--t-muted)' }}>No matches.</li>}
          {results.map((c) => (
            <li key={c.personKey}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="nav-link"
                style={{ display: 'flex', width: '100%', justifyContent: 'space-between', border: '1px solid var(--border)', padding: '8px 10px' }}
              >
                <span style={{ color: 'var(--t-base)' }}>
                  {c.personLname}, {c.personFname} {c.personMname ?? ''}
                </span>
                <span style={{ color: 'var(--t-muted)', fontSize: 11.5 }}>
                  {c.personBdate?.slice(0, 10)} &middot; {c.barangay?.name ?? 'No barangay'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
