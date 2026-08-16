import { cloudinary, isCloudinaryConfigured } from '#config/cloudinary.js';
import {
  CLOUDINARY_QUESTION_FOLDER,
  CLOUDINARY_UPLOAD_TIMEOUT_MS,
} from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';

/**
 * Bytes to a stored, publicly readable URL. PR 3.2, MVP.md §12.
 *
 * The only file besides `config/cloudinary.js` that knows which image host this
 * project uses. Callers hand it a buffer and receive a URL — `question.intake.service`
 * writes that URL to a row and never learns where it came from, which is what makes
 * a future move to another host one file's problem.
 *
 * **Every failure here is `EXTERNAL_SERVICE_ERROR` (502), never `INTERNAL_ERROR`.**
 * The code exists in `shared/errorCodes.js` for exactly this distinction: our code is
 * fine, the third party is not, and the client can say "couldn't save the photo, try
 * again" rather than "something went wrong". A 500 would also be a lie in the metric
 * that matters — it would count a Cloudinary outage as our bug.
 *
 * **Nothing here is logged with the buffer or the credentials in it.** The SDK's error
 * objects carry the request it made; only its `message` is logged, and the response
 * is reduced to the two fields the caller needs. A signed upload URL in a log line is
 * a credential in a log line.
 */

/**
 * Store one question image.
 *
 * `upload_stream` rather than `upload`: the SDK's `upload` takes a path or a data URI,
 * and both mean either writing the file to a disk that does not survive a Render
 * restart, or base64-encoding it in memory at 4/3 the size. The stream takes the
 * buffer Multer already holds.
 *
 * `resource_type: 'image'` is explicit, not inferred. Cloudinary's default is `auto`,
 * which happily stores a PDF or a video under a folder called `questions` — the
 * allowlist is enforced in `middlewares/upload.js` and this is the same rule restated
 * where the bytes actually leave the process.
 *
 * The public id is left to Cloudinary. The student's filename is data, never a path:
 * building an id from it would let an upload named `../../avatars/dana` decide where
 * it lands.
 *
 * @param {object} file
 * @param {Buffer} file.buffer     the whole image, from memory storage
 * @param {string} file.mimeType   the **detected** type, not the declared one
 * @returns {Promise<{fileUrl: string, mimeType: string}>}
 */
export async function uploadQuestionImage({ buffer, mimeType }) {
  if (!isCloudinaryConfigured) {
    // A configuration mistake, not a student's mistake. Named in the log so the fix
    // is obvious, and generic in the response so the variable names stay ours.
    logger.error('Cloudinary upload attempted with missing credentials', {
      folder: CLOUDINARY_QUESTION_FOLDER,
    });
    throw uploadFailed();
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_QUESTION_FOLDER,
        resource_type: 'image',
        timeout: CLOUDINARY_UPLOAD_TIMEOUT_MS,
      },
      (error, uploaded) => {
        if (error) return reject(error);
        if (!uploaded?.secure_url) return reject(new Error('Cloudinary returned no secure_url'));
        resolve(uploaded);
      },
    );

    stream.end(buffer);
  }).catch((error) => {
    logger.error('Cloudinary upload failed', {
      // The message only. The error object carries the signed request that produced
      // it, and that request is credentials.
      reason: error?.message,
      folder: CLOUDINARY_QUESTION_FOLDER,
    });
    throw uploadFailed();
  });

  return { fileUrl: result.secure_url, mimeType };
}

/**
 * One answer for refused, timed out and unconfigured.
 *
 * The student can act on exactly one thing — try again — and the three causes differ
 * only in what *we* have to fix, which is what the log line above is for.
 */
function uploadFailed() {
  return new AppError(
    ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    'We could not save that image. Please try again.',
  );
}
