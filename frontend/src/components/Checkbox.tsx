// Labeled checkbox using the app's shared `.check`/`.box` styling, used
// anywhere a plain boolean toggle needs a label next to it.
export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" />
      {label}
    </label>
  );
}
