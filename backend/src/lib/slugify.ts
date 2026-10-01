// Turns an admin-typed label into a URL/JSON-key-safe identifier: lowercase,
// non-alphanumeric runs collapsed to a single underscore, no leading/
// trailing underscore. Used for both an Office's slug and an
// OfficeFormField's JSON key -- both are derived from a name/label an admin
// types, rather than typed directly, so there's one fewer thing to get
// wrong (a duplicate/invalid key/slug).
export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'field';
}
