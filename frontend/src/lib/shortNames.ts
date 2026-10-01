// Admin-set office short names (Office details > Short name), keyed by the
// office's full name. lib/api fills it whenever offices load, so
// shortName(name) everywhere picks up e.g. "CENRO" without passing objects.
const SHORT_BY_NAME = new Map<string, string>();

export function registerShortNames(offices: Array<{ name: string; shortName?: string | null }>): void {
  for (const o of offices) {
    const v = o.shortName?.trim();
    if (v) SHORT_BY_NAME.set(o.name, v);
    else SHORT_BY_NAME.delete(o.name);
  }
}

export function adminShortName(name: string): string | undefined {
  return SHORT_BY_NAME.get(name);
}
