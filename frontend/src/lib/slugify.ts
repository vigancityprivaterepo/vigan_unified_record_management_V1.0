// Same charset the backend requires (lowercase letters, digits,
// underscores) -- used to auto-suggest a slug/identifier from a name as
// admin types, without silently reformatting what they then edit by hand.
// Shared by office and module creation forms.
export function slugifyPreview(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
