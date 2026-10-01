import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';

export type OfficeOption = { key: string; label: string; hue: number | null; count: number };

// Searchable office dropdown -- replaces a row of per-office chips once a
// city has more offices than fit on one line (Visualizations, Staff accounts).
export function OfficePicker({ options, value, onChange, placeholder = 'Office' }: {
  options: OfficeOption[];
  value: string | null;
  onChange: (key: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.key === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const term = q.trim().toLowerCase();
  const shown = term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options;

  return (
    <div className="ws-picker" ref={wrap}>
      <button type="button" className={`ws-chip${selected ? ' is-on' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {selected ? `${selected.label} · ${selected.count}` : `${placeholder} (${options.length})`}
        <Icon name="chevR" size={14} className="ws-picker-chev" />
      </button>
      {open && (
        <div className="ws-picker-menu" role="listbox">
          <div className="ws-picker-search">
            <Icon name="search" size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an office" aria-label="Find an office" />
          </div>
          <div className="ws-picker-list">
            {shown.map((o) => (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={o.key === value}
                className={`ws-picker-item${o.key === value ? ' is-on' : ''}`}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                  setQ('');
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--t-muted)' }}>{o.count}</span>
              </button>
            ))}
            {shown.length === 0 && <div style={{ padding: 10, fontSize: 13, color: 'var(--t-muted)' }}>No office matches “{q}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}
