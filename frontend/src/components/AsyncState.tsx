// Shared loading/error rendering so each section doesn't re-implement the
// same two-line if/if block. Renders nothing once data has arrived.
export function AsyncState({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <div className="field-error">{error}</div>;
  if (loading) return <span className="spinner" />;
  return null;
}
