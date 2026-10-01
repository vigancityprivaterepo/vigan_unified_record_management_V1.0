import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';
import { getDocumentFromMinio, uploadDocumentToMinio } from './minio';

// Where uploaded documents (birth certificates, Mayor's Permit copies, tax
// declaration scans...) live. DOCUMENT_STORAGE=minio (default, the Docker
// stack) or DOCUMENT_STORAGE=local -- a folder on the server, for installs
// where the MinIO image isn't available. Keys always come from
// makeDocumentObjectKey (random UUID + sanitized name), and are re-checked
// here so a stored key can never point outside the documents folder.
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]+$/;

function localPath(objectKey: string): string {
  if (!KEY_PATTERN.test(objectKey)) throw new Error('Invalid document key');
  const dir = path.resolve(env.documentDir);
  const full = path.resolve(dir, objectKey);
  if (path.dirname(full) !== dir) throw new Error('Invalid document key');
  return full;
}

export async function uploadDocument(objectKey: string, buffer: Buffer, mimeType: string): Promise<void> {
  if (env.documentStorage === 'local') {
    const full = localPath(objectKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer);
    await writeFile(`${full}.meta.json`, JSON.stringify({ contentType: mimeType }));
    return;
  }
  await uploadDocumentToMinio(objectKey, buffer, mimeType);
}

export async function readDocument(objectKey: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (!KEY_PATTERN.test(objectKey)) return null;
  if (env.documentStorage === 'local') {
    const full = localPath(objectKey);
    try {
      const [body, meta] = await Promise.all([readFile(full), readFile(`${full}.meta.json`, 'utf8').catch(() => '{}')]);
      const contentType = (JSON.parse(meta) as { contentType?: string }).contentType ?? 'application/octet-stream';
      return { body, contentType };
    } catch {
      return null;
    }
  }
  return getDocumentFromMinio(objectKey);
}
