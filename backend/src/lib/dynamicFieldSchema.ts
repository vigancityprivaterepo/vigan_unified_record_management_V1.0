import { z, type ZodRawShape, type ZodTypeAny } from 'zod';

export type DynamicFieldDef = { key: string; fieldType: string; options: string[]; isRequired: boolean };

// Builds a Zod schema for one admin-defined field (OfficeFormField row)
// from its stored type. DATE is transformed straight to an ISO date string
// (not left as a JS Date) because the result is stored as JSON -- either
// OfficeRecord.data or a satellite table's extra_data column -- and a Date
// object isn't valid JSON.
// PH mobile (09XXXXXXXXX / +639XXXXXXXXX) and landline (area code + number)
// formats, loosely -- reject obvious garbage without being a strict
// carrier-format validator.
const PHONE_PATTERN = /^[0-9+()\-.\s]{7,20}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function fieldSchema(field: DynamicFieldDef): ZodTypeAny {
  // Array-shaped, so it can't share the scalar isRequired wrapping below --
  // "required" here means "at least one option picked," not "not undefined".
  if (field.fieldType === 'MULTISELECT') {
    const arr = field.options.length > 0 ? z.array(z.enum(field.options as [string, ...string[]])) : z.array(z.string());
    return field.isRequired ? arr.min(1, 'Select at least one option') : arr;
  }

  let base: ZodTypeAny;
  switch (field.fieldType) {
    case 'NUMBER':
      base = z.coerce.number();
      break;
    case 'DATE':
      base = z.coerce.date().transform((d) => d.toISOString().slice(0, 10));
      break;
    case 'TIME':
      base = z.string().trim().regex(TIME_PATTERN, 'Invalid time (HH:MM)');
      break;
    case 'BOOLEAN':
      base = z.boolean();
      break;
    case 'SELECT':
      base = field.options.length > 0 ? z.enum(field.options as [string, ...string[]]) : z.string().trim();
      break;
    case 'EMAIL':
      base = z.string().trim().email();
      break;
    case 'PHONE':
      base = z.string().trim().regex(PHONE_PATTERN, 'Invalid phone number');
      break;
    default:
      // TEXT, TEXTAREA -- same free-text validation, only the intake form's
      // own input vs. textarea rendering differs (see DynamicExtraFields.tsx).
      base = z.string().trim();
  }
  return field.isRequired ? base : base.optional();
}

// Combines a set of field definitions into one object schema, keyed by
// each field's `key` -- shared by the dynamic-office intake route and the
// six original offices' intake routes, so a submission's `customFields` /
// `fields` sub-object is validated the same way everywhere admin-defined
// fields show up.
export function buildDynamicFieldsSchema(fields: DynamicFieldDef[]): z.ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};
  for (const f of fields) {
    shape[f.key] = fieldSchema(f);
  }
  return z.object(shape);
}
