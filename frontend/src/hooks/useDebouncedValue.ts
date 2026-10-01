import { useEffect, useState } from 'react';

// Delays reflecting a fast-changing value (e.g. a search input) until it's
// stopped changing for `delayMs` -- used by every live-as-you-type search
// (Citizens, office records, the household CitizenPicker) so a query fires
// once per pause in typing, not once per keystroke. The first render's
// value is returned immediately (no artificial delay on initial load).
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
