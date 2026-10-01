import * as Minio from 'minio';
import { env } from '../env';

const BUCKET = 'vigan-documents';

let client: Minio.Client | undefined;
function getClient(): Minio.Client {
  if (!client) {
    client = new Minio.Client({
      endPoint: env.minioEndpoint,
      port: env.minioPort,
      useSSL: false,
      accessKey: env.minioAccessKey,
      secretKey: env.minioSecretKey,
    });
  }
  return client;
}

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const c = getClient();
  const exists = await c.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await c.makeBucket(BUCKET);
  }
  bucketEnsured = true;
}

// Stores a document (birth certificate scan, etc.) under a random,
// collision-free key -- never the raw uploaded filename, see
// sanitizeFilename.ts for why. Returns the MinIO object key to store in
// birth_upload_doc.
export async function uploadDocumentToMinio(objectKey: string, buffer: Buffer, mimeType: string): Promise<void> {
  await ensureBucket();
  await getClient().putObject(BUCKET, objectKey, buffer, buffer.length, { 'Content-Type': mimeType });
}

export async function getDocumentFromMinio(objectKey: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const c = getClient();
    const stat = await c.statObject(BUCKET, objectKey);
    const stream = await c.getObject(BUCKET, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const contentType = (stat.metaData?.['content-type'] as string | undefined) ?? 'application/octet-stream';
    return { body: Buffer.concat(chunks), contentType };
  } catch {
    return null;
  }
}
