import { createAttachment } from '#repositories/question.repository.js';
import { uploadQuestionImage } from '#services/media.service.js';

/**
 * Capture — the student's words and pixels reaching the database. DEV-A's half of E3.
 *
 * PR 3.2 fills in the attachment half. `createQuestion` (3.4) joins it here and
 * orchestrates commit → classify → update; the two share this file because they share
 * the repository calls and neither of them is DEV-B's.
 *
 * No request or response object reaches this layer, and no controller below it
 * touches the database (CONVENTIONS.md → Server layering).
 */

/**
 * Store one image and record the row that will later be bound to a question.
 *
 * Two steps in one direction, and the order is the safe one: the bytes reach
 * Cloudinary first, and only a stored URL becomes a row. The reverse — a row written
 * optimistically and updated after the upload — leaves an attachment id a student can
 * send to `POST /questions` while it points at nothing.
 *
 * The row lands with `question_id = NULL` and `uploaded_by` set to the caller, which
 * is the pair `POST /questions` later reads as "mine, and not yet used". A failed
 * upload writes nothing at all.
 *
 * **An orphan row is the accepted failure mode.** A student who uploads a photo and
 * then abandons the form leaves a Cloudinary asset and an unbound row behind. Neither
 * is reachable — `findBindableAttachmentIds` scopes to the uploader, so nobody else
 * can claim it — and a sweep of `question_id IS NULL` older than a day is a job for
 * whoever owns cleanup, not a reason to make the upload transactional against a
 * question that does not exist yet.
 *
 * The repository already selects exactly the contract's `Attachment` — id, fileUrl,
 * mimeType — so there is no serializer here. `questionView.js` owns the shape of a
 * *question*, and an attachment inside one goes through it there.
 *
 * @param {object} input
 * @param {string} input.studentId  the caller, from `req.user.id`
 * @param {{buffer: Buffer, mimetype: string}} input.file  Multer's file, already
 *   proved to be an allowed image by `middlewares/upload.js`
 * @returns {Promise<import('@tutor/shared').Attachment>}
 */
export async function createQuestionAttachment({ studentId, file }) {
  const { fileUrl, mimeType } = await uploadQuestionImage({
    buffer: file.buffer,
    // The detected type, which the upload middleware wrote back over the declared
    // one. Storing what the uploader claimed would put a lie in a column that 3.3's
    // Vision call reads.
    mimeType: file.mimetype,
  });

  return createAttachment({ uploadedBy: studentId, fileUrl, mimeType });
}
