import { ApiError } from '@/lib/api';

// Error state for data that failed to load: says what failed, why (when the
// server said), and offers Retry. Use it instead of falling back to an empty
// list, which would read as "there is nothing here".
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  const reason = error instanceof ApiError ? error.message : error instanceof Error ? error.message : null;
  return (
    <div className="alert danger" role="alert">
      <div className="body">
        <strong>Couldn't load {what}.</strong> {reason ? `${reason}.` : 'Check the connection to the server.'}
      </div>
      {onRetry && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
