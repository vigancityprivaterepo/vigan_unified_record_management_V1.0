import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { recordPersonName } from '@/components/RecordStatusPill';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api, type OfficeModule } from '@/lib/api';

type Hit = { key: string; name: string; sub: string; target: string };

// Top-bar search. Admin searches the citizen registry; office staff search
// their own office's records across every module. Picking a hit (or Enter)
// opens the matching list page with the query already filled in.
export function TopbarSearch({ scope, placeholder, onOpen, autoFocus = false, onRequestMobile }: {
  scope: { kind: 'admin' } | { kind: 'office'; officeId: string; modules: OfficeModule[] };
  placeholder: string;
  onOpen: (target: string, q: string) => void;
  // The small-screen copy opens already focused.
  autoFocus?: boolean;
  // Ctrl+K while this (desktop) box is hidden on a small screen: ask the
  // shell to open the small-screen search instead.
  onRequestMobile?: () => void;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim());
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K jumps to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (!onRequestMobile) return; // only the desktop box owns the shortcut
        e.preventDefault();
        if (inputRef.current && inputRef.current.offsetParent === null) {
          onRequestMobile();
          return;
        }
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRequestMobile]);

  useEffect(() => {
    if (debounced.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const run =
      scope.kind === 'admin'
        ? api.searchCitizens(debounced, 1).then((p) =>
            p.items.slice(0, 6).map((c) => ({
              key: c.personKey,
              name: [c.personFname, c.personMname, c.personLname].filter(Boolean).join(' '),
              sub: [c.barangay?.name, c.personBdate?.slice(0, 10)].filter(Boolean).join(' · '),
              target: 'citizens',
            })),
          )
        : Promise.all(
            scope.modules.map((m) =>
              api
                .myOfficeModuleRecords(scope.officeId, m.id, debounced, 1)
                .then((p) => p.items.slice(0, 4).map((r) => ({ key: r.id, name: recordPersonName(r), sub: m.name, target: `records:${m.id}` })))
                .catch(() => [] as Hit[]),
            ),
          ).then((lists) => lists.flat().slice(0, 8));
    run.then((h) => !cancelled && setHits(h)).catch(() => !cancelled && setHits([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope is rebuilt every render; its identity isn't the trigger.
  }, [debounced, scope.kind === 'office' ? scope.officeId : '', scope.kind === 'office' ? scope.modules : null]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function go(target: string) {
    onOpen(target, q.trim());
    setOpen(false);
    setQ('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    const first = hits?.[0]?.target ?? (scope.kind === 'admin' ? 'citizens' : scope.modules[0] ? `records:${scope.modules[0].id}` : null);
    if (first) go(first);
  }

  return (
    <div className="ws-search" ref={wrapRef}>
      <form onSubmit={handleSubmit} role="search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          value={q}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          autoFocus={autoFocus}
        />
        <kbd className="ws-kbd" aria-hidden="true">Ctrl K</kbd>
      </form>
      {open && hits !== null && (
        <div className="ws-search-menu" role="listbox">
          {hits.length === 0 && <div className="ws-search-empty">No matches for “{debounced}”</div>}
          {hits.map((h) => (
            <button key={h.key} type="button" className="ws-search-hit" onClick={() => go(h.target)}>
              <span style={{ fontWeight: 600 }}>{h.name}</span>
              {h.sub && <span style={{ fontSize: 12, color: 'var(--t-muted)' }}>{h.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
