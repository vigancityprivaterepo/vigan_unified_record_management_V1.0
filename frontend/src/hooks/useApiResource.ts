import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';

// Generic "fetch on mount, track loading/error, allow a manual refetch"
// hook -- most admin pages' sections follow the exact same
// fetch -> setData / catch -> setError shape.
export function useApiResource<T>(fetchFn: () => Promise<T>, fallbackMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchFn()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : fallbackMessage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, setError, reload };
}
