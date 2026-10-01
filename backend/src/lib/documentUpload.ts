import multer from 'multer';

// Birth certificate / supporting-document uploads: scans and photographed
// IDs, not arbitrary files.
export const ALLOWED_UPLOAD_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

// Distinguishable from a generic Error so the app-level error handler can
// tell "this file was rejected" apart from an unrelated bug elsewhere and
// respond 400 only for the former -- a bare `Error` would be indistinguishable
// from any other uncaught exception.
export class UploadValidationError extends Error {}

// Memory storage: files are small (one document per birth record) and get
// streamed straight to MinIO, never touch local disk.
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype)) {
      // Reject via an error, not `cb(null, false)` -- the latter just
      // silently drops the file instead of failing the request, which
      // would leave a birth record created with no document and no
      // indication why.
      cb(new UploadValidationError(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});
