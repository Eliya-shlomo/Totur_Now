/**
 * Multipart file intake for `POST /questions/attachments`. MVP.md §12, PR 3.2.
 *
 * **A pass-through until 3.2 (DEV-A) replaces the body with Multer.** It exists now,
 * with the interface it will keep, because `question.routes.js` is frozen after this
 * PR: the route already reads
 *
 *   upload.single(ATTACHMENT_FIELD_NAME)
 *
 * and 3.2 swaps what `upload` is without that line changing. A middleware added to a
 * frozen router later is precisely the failure this PR exists to prevent — 2.1 proved
 * the pattern on four teacher routes and none of them moved.
 *
 * What 3.2 puts here, every bound from `constants/question.js` and none of them
 * retyped:
 *
 *   multer.memoryStorage()                    the buffer goes straight to Cloudinary;
 *                                             nothing this epic uploads touches disk
 *   limits.fileSize  = MAX_IMAGE_BYTES        the size cap, server-side
 *   limits.files     = 1                      one image per request; the per-question
 *                                             cap is MAX_ATTACHMENTS and belongs to
 *                                             `POST /questions`, not to one upload
 *   fileFilter                                ALLOWED_IMAGE_MIME_TYPES, checked against
 *                                             the parsed type and never the filename
 *
 * The client's `accept` attribute (3.6) is a convenience for the file picker. This is
 * the rule — a request that never met a file picker still meets this.
 *
 * 3.2 also translates Multer's own errors into the standard shape: `LIMIT_FILE_SIZE`
 * is a `VALIDATION_ERROR` naming the cap, not a 500. Its `MulterError` never reaches
 * `errorHandler` as an unknown exception.
 *
 * Only the file half of the request belongs here. Where the bytes end up is
 * `media.service` (3.2), and which student may attach the resulting row is the
 * `uploadedBy` check in `question.repository.js` — three separate concerns, and this
 * file holds the smallest of them.
 */

/**
 * The Multer-shaped object the frozen router calls.
 *
 * `single(fieldName)` returns a middleware that does nothing today: no file is
 * parsed, so the controller behind it sees no file and throws `NOT_IMPLEMENTED`
 * regardless — which is the answer this PR promises for all four routes. The
 * argument is accepted and deliberately unread; 3.2's Multer is what starts using it.
 */
export const upload = {
  single() {
    return function parseSingleUpload(_req, _res, next) {
      next();
    };
  },
};
