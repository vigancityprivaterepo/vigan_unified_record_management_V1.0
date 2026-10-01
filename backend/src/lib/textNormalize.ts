// Government records in this system are stored uppercase, matching the
// convention on physical LGU forms and keeping stored text consistent
// regardless of how staff typed it. resolvePerson()'s own matching is
// already case-insensitive (lower() on both sides), so this doesn't change
// what counts as a duplicate -- it only normalizes what gets written.
// Form-field variant: only free-text fields are uppercased. Dropdown values
// (SELECT/MULTISELECT) must stay exactly as the admin defined the options,
// or charts and "only records where X = Y" filters stop matching them;
// dates/emails/phones aren't names and keep their typed form too.
const FREE_TEXT_TYPES = new Set(['TEXT', 'TEXTAREA']);
export function uppercaseFreeText<T extends Record<string, unknown>>(data: T, fields: Array<{ key: string; fieldType: string }>): T {
  const result = { ...data };
  for (const f of fields) {
    const value = result[f.key];
    if (FREE_TEXT_TYPES.has(f.fieldType) && typeof value === 'string') {
      result[f.key as keyof T] = value.toUpperCase() as T[keyof T];
    }
  }
  return result;
}

export function uppercaseStrings<T extends Record<string, unknown>>(data: T): T {
  const result = { ...data };
  for (const key of Object.keys(result) as Array<keyof T>) {
    const value = result[key];
    if (typeof value === 'string') {
      result[key] = value.toUpperCase() as T[typeof key];
    }
  }
  return result;
}
