import { useEffect, useState } from 'react';
import { Pagination } from '@/components/Pagination';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ApiError, type Paginated } from '@/lib/api';

export type RecordColumn<T> = {
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
};

// Shared table shell for every office's "my records" list -- the backend
// already scopes each endpoint to the caller's own office (requireRole +
// getPrismaForRole), so this only has to fetch, search, paginate, and
// render; it never decides which rows a role is allowed to see.
export function RecordsListTable<T, R extends Paginated<T> = Paginated<T>>({
  fetcher,
  columns,
  getKey,
  searchPlaceholder,
  emptyLabel,
  renderActions,
  initialQuery = '',
  toolbar,
  onLoaded,
}: {
  fetcher: (q: string | undefined, page: number) => Promise<R>;
  columns: RecordColumn<T>[];
  getKey: (row: T) => string;
  searchPlaceholder: string;
  emptyLabel: string;
  // Trailing "Actions" column, e.g. an Archive button -- given `reload` so
  // it can refresh the current page itself (row state lives here, not in
  // the caller).
  renderActions?: (row: T, reload: () => void) => React.ReactNode;
  // Pre-fills the search box, e.g. when arriving from the top-bar search.
  initialQuery?: string;
  // Extra controls on the search row (status filter chips).
  toolbar?: React.ReactNode;
  // Lets the caller read list-level extras the endpoint returns (counts).
  onLoaded?: (result: R) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const debouncedQuery = useDebouncedValue(query);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function load(q: string | undefined, p: number) {
    setLoading(true);
    setError(null);
    fetcher(q, p)
      .then((r) => {
        setResult(r);
        onLoaded?.(r);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load records'))
      .finally(() => setLoading(false));
  }

  // Live search -- fires once the query settles (see useDebouncedValue),
  // not on every keystroke. Resets to page 1 since a new search's results
  // may not have as many pages as whichever page was showing before.
  useEffect(() => {
    setPage(1);
    load(debouncedQuery || undefined, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, debouncedQuery]);

  function handleSearch(e: React.FormEvent) {
    // Submitting (Enter, or the button) jumps the search immediately
    // instead of waiting out the debounce -- live search above still
    // covers typing-and-pausing.
    e.preventDefault();
    setPage(1);
    load(query || undefined, 1);
  }

  function handlePageChange(p: number) {
    setPage(p);
    load(query || undefined, p);
  }

  const rows = result?.items ?? null;

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: '1 1 280px', maxWidth: toolbar ? 420 : undefined }}>
          <input
            className="input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn btn--primary" style={{ flexShrink: 0 }}>
            Search
          </button>
        </form>
        {toolbar}
      </div>

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

      {loading && <span className="spinner" />}
      {!loading && rows && rows.length === 0 && <p style={{ fontSize: 13, color: 'var(--t-muted)' }}>{emptyLabel}</p>}

      {!loading && rows && rows.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.header} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                      {c.header}
                    </th>
                  ))}
                  {renderActions && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={getKey(row)}>
                    {columns.map((c) => (
                      <td key={c.header} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                        {c.render(row)}
                      </td>
                    ))}
                    {renderActions && (
                      <td style={{ textAlign: 'right' }}>{renderActions(row, () => load(query || undefined, page))}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result && <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPageChange={handlePageChange} />}
        </>
      )}
    </div>
  );
}
