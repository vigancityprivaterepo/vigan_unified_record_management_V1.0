import { useEffect, useRef } from 'react';

const openStack: object[] = [];

// Generic popup shell -- backdrop click, Escape, and the corner X all close
// it via the same onClose callback. Nests fine (a modal opened from inside
// another modal just stacks on top, each with its own backdrop).
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
  // Detail views (a household) get more room than a form.
  wide?: boolean;
}) {
  // Escape closes only the topmost popup: each open Modal pushes a token on
  // a shared stack and reacts only while its token is on top.
  const token = useRef({});
  useEffect(() => {
    const me = token.current;
    openStack.push(me);
    return () => {
      const i = openStack.lastIndexOf(me);
      if (i >= 0) openStack.splice(i, 1);
    };
  }, []);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === token.current) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" style={wide ? { maxWidth: 980 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="card-title-wrap">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h3 className="card-title">{title}</h3>
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
