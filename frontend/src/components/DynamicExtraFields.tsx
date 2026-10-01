import { Checkbox } from '@/components/Checkbox';
import type { OfficeFormField } from '@/lib/api';

export type FieldValue = string | boolean | string[];
export type FieldValues = Record<string, FieldValue>;
export type FileValues = Record<string, File | undefined>;

// FILE fields are excluded -- they have no JSON-safe default and are
// tracked separately (see FileValues) since they're sent as actual file
// parts, not JSON, on submit.
export function defaultFieldValues(fields: OfficeFormField[]): FieldValues {
  return Object.fromEntries(
    fields
      .filter((f) => f.fieldType !== 'FILE')
      .map((f) => [f.key, f.fieldType === 'BOOLEAN' ? false : f.fieldType === 'MULTISELECT' ? [] : '']),
  );
}

// Converts the raw form-state values (string|boolean|string[], since that's
// what an <input>/<select>/checkbox group gives you) into what the backend
// expects per field type. FILE fields are skipped -- they never go in this
// JSON blob, see FileValues/officeRecordFormData in lib/api.ts.
export function toSubmitValues(
  fields: OfficeFormField[],
  values: FieldValues,
): Record<string, string | number | boolean | string[] | undefined> {
  const out: Record<string, string | number | boolean | string[] | undefined> = {};
  for (const field of fields) {
    if (field.fieldType === 'FILE') continue;
    const raw = values[field.key];
    if (field.fieldType === 'BOOLEAN') {
      out[field.key] = Boolean(raw);
    } else if (field.fieldType === 'NUMBER') {
      out[field.key] = raw === '' ? undefined : Number(raw);
    } else if (field.fieldType === 'MULTISELECT') {
      out[field.key] = Array.isArray(raw) ? raw : [];
    } else {
      out[field.key] = raw === '' ? undefined : (raw as string);
    }
  }
  return out;
}

// Renders one admin-defined field per its stored type -- shared by every
// module's intake form. FILE fields render a plain file input and report
// through onFileChange instead of onChange.
export function DynamicExtraFields({
  fields,
  values,
  onChange,
  fileValues,
  onFileChange,
}: {
  fields: OfficeFormField[];
  values: FieldValues;
  onChange: (key: string, value: FieldValue) => void;
  fileValues?: FileValues;
  onFileChange?: (key: string, file: File | undefined) => void;
}) {
  if (fields.length === 0) return null;

  function toggleMultiselect(field: OfficeFormField, option: string, checked: boolean) {
    const current = Array.isArray(values[field.key]) ? (values[field.key] as string[]) : [];
    onChange(field.key, checked ? [...current, option] : current.filter((o) => o !== option));
  }

  return (
    <div className="form-grid">
      {fields.map((field) => (
        <div
          key={field.id}
          className={field.fieldType === 'BOOLEAN' || field.fieldType === 'MULTISELECT' || field.fieldType === 'TEXTAREA' ? 'field span-2' : 'field'}
        >
          {field.fieldType === 'BOOLEAN' ? (
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(values[field.key])}
                onChange={(e) => onChange(field.key, e.target.checked)}
              />
              <span className="box" />
              {field.label}
            </label>
          ) : (
            <>
              <label className="field-label" htmlFor={field.id}>
                {field.label}
                {field.isRequired && <span className="req">*</span>}
              </label>
              {field.fieldType === 'SELECT' ? (
                <select
                  id={field.id}
                  className="select"
                  required={field.isRequired}
                  value={(values[field.key] as string) ?? ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                >
                  <option value="" disabled>
                    Select
                  </option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : field.fieldType === 'MULTISELECT' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px' }}>
                  {field.options.map((opt) => (
                    <Checkbox
                      key={opt}
                      label={opt}
                      checked={Array.isArray(values[field.key]) && (values[field.key] as string[]).includes(opt)}
                      onChange={(checked) => toggleMultiselect(field, opt, checked)}
                    />
                  ))}
                </div>
              ) : field.fieldType === 'TEXTAREA' ? (
                <textarea
                  id={field.id}
                  className="input"
                  rows={3}
                  required={field.isRequired}
                  value={(values[field.key] as string) ?? ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                />
              ) : field.fieldType === 'FILE' ? (
                <input
                  id={field.id}
                  className="input"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  required={field.isRequired && !fileValues?.[field.key]}
                  onChange={(e) => onFileChange?.(field.key, e.target.files?.[0])}
                />
              ) : (
                <input
                  id={field.id}
                  className="input"
                  type={
                    field.fieldType === 'NUMBER'
                      ? 'number'
                      : field.fieldType === 'DATE'
                        ? 'date'
                        : field.fieldType === 'TIME'
                          ? 'time'
                          : field.fieldType === 'EMAIL'
                            ? 'email'
                            : field.fieldType === 'PHONE'
                              ? 'tel'
                              : 'text'
                  }
                  required={field.isRequired}
                  value={(values[field.key] as string) ?? ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                />
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
