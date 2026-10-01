import { randomUUID } from 'node:crypto';

// MinIO object keys aren't filesystem paths, but a key derived from the
// original filename can still smuggle a path-traversal-shaped string
// (`../../etc`, backslash-separated Windows paths) into object storage
// tooling, logs, or a future filesystem-backed export -- strip any path
// components and unsafe characters before it's used for anything.
function sanitizeBaseName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned || 'file';
}

// Random prefix guarantees a unique object key regardless of what two
// staff members happen to name their uploads.
export function makeDocumentObjectKey(originalFilename: string): string {
  return `${randomUUID()}-${sanitizeBaseName(originalFilename)}`;
}
