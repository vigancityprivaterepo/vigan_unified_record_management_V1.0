// Icon-only row action -- every table's "Actions" column (Staff Accounts,
// Offices, module fields, Saved Records, Visualizations, Households) uses
// this instead of a text-labeled button, so a row of 3-4 actions stays
// compact. `label` is required and does the accessibility/discoverability
// work a visible word normally would: it's both the hover tooltip (title)
// and the screen-reader name (aria-label), never dropped.
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm btn--icon"
      style={danger ? { color: 'var(--danger)' } : undefined}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" dangerouslySetInnerHTML={{ __html: icon }} />
    </button>
  );
}
