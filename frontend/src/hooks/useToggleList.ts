import { useState } from 'react';

// A set of selected string ids with checkbox-friendly toggle semantics,
// an optional selection cap (e.g. "group by" allows at most 2 dimensions),
// and a `prune` escape hatch for dropping selections that became invalid
// (e.g. a field option that disappeared because its source module was
// deselected).
export function useToggleList(max?: number) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(value: string, checked: boolean) {
    setSelected((prev) => {
      if (checked) {
        if (prev.includes(value)) return prev;
        if (max !== undefined && prev.length >= max) return prev;
        return [...prev, value];
      }
      return prev.filter((v) => v !== value);
    });
  }

  function prune(keep: (value: string) => boolean) {
    setSelected((prev) => prev.filter(keep));
  }

  return { selected, setSelected, toggle, prune };
}
