import { useEffect, useState } from 'react';

// Closed-by-default multi-select -- the panel (checkboxes, grouped or flat,
// whatever the caller passes as children) only takes up space once opened,
// instead of a big always-open box dominating the form. Click-outside-to-
// close matches App.tsx's own profile-menu dropdown pattern.
export function MultiSelectDropdown({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="select-dropdown" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="select-dropdown-trigger" onClick={() => setOpen((v) => !v)}>
          <span>{summary}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open && <div className="select-dropdown-panel">{children}</div>}
      </div>
    </div>
  );
}
