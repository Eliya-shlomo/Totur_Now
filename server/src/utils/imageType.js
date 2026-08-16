import { ALLOWED_IMAGE_MIME_TYPES } from '#config/constants/index.js';

/**
 * What an uploaded file actually is, read from its first bytes. PR 3.2.
 *
 * **Why this exists at all.** A multipart part carries a `Content-Type` header, and
 * that header is written by whoever is uploading — a browser guesses it from the file
 * extension, and `curl -F image=@notes.txt` guesses it the same way. So the "MIME
 * type" Multer reports for a `.txt` renamed to `.jpg` is `image/jpeg`, and a check
 * against it passes a text file straight through to a Vision model. 3.2's acceptance
 * criteria name that exact case, which is why the declared type is treated as a hint
 * and the bytes as the answer.
 *
 * Every format below is identified by a fixed signature at a fixed offset — the same
 * few bytes `file(1)` reads. No dependency: three formats, three constants, and a
 * wrong answer is a rejected upload rather than a corrupted one.
 *
 * A file whose bytes are not one of these three is not "unknown", it is refused. The
 * allowlist is the rule; this function is how the rule is applied to something other
 * than a filename.
 */

/**
 * Signature per allowed type, as [offset, bytes] pairs — every pair must match.
 *
 * JPEG starts `FF D8 FF`, the SOI marker plus the first segment's marker byte. PNG
 * has an eight-byte signature whose `0D 0A 1A 0A` tail exists to catch transfers that
 * mangled line endings. WebP is a RIFF container: `RIFF`, then four bytes of length
 * that say nothing about the format, then `WEBP` — which is why it needs two pairs
 * and why checking only `RIFF` would also accept a WAV file.
 */
const SIGNATURES = {
  'image/jpeg': [[0, [0xff, 0xd8, 0xff]]],
  'image/png': [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  'image/webp': [
    [0, [0x52, 0x49, 0x46, 0x46]],
    [8, [0x57, 0x45, 0x42, 0x50]],
  ],
};

// A type allowed but not described here would be rejected by every upload, and the
// bug would read as "Cloudinary is broken" rather than "the table is short one row".
// Checked at boot, the way MATCH_WEIGHTS is (`constants/matching.js`).
const undescribed = ALLOWED_IMAGE_MIME_TYPES.filter((type) => !SIGNATURES[type]);
if (undescribed.length > 0) {
  throw new Error(
    `ALLOWED_IMAGE_MIME_TYPES contains types with no signature in imageType.js: ${undescribed.join(', ')}`,
  );
}

/**
 * The MIME type of `buffer`, or `null` if it is not an allowed image.
 *
 * Only the allowlist is described, so "not one of ours" and "not an image at all"
 * answer the same way. The caller does not need the difference: both are a
 * `VALIDATION_ERROR` naming the allowed types, and telling an uploader that we
 * correctly identified their PDF is information they can only use to try again with
 * something else disguised.
 *
 * @param {Buffer} buffer  the whole file, from Multer's memory storage
 * @returns {string|null}  one of ALLOWED_IMAGE_MIME_TYPES, or null
 */
export function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  return (
    ALLOWED_IMAGE_MIME_TYPES.find((type) =>
      SIGNATURES[type].every(([offset, bytes]) =>
        bytes.every((byte, index) => buffer[offset + index] === byte),
      ),
    ) ?? null
  );
}
