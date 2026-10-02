// Shared Prev/Next pager -- used by every paginated list (office records,
// citizens, households), each backed by a fixed server-side page size (see
// backend/src/lib/pagination.ts). Renders nothing for a single page, same
// as an empty state needing no controls.
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 16,
        paddingTop: 16,
        borderTop: '1px solid var(--border-soft)',
        fontSize: 13,
        color: 'var(--t-muted)',
      }}
    >
      <span>
        {from}-{to} of {total}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
