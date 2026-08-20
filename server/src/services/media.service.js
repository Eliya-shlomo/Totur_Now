import { cloudinary, isCloudinaryConfigured } from '#config/cloudinary.js';
import {
  CLOUDINARY_CLASSIFICATION_TRANSFORM,
  CLOUDINARY_DELIVERY_HOST,
  CLOUDINARY_QUESTION_FOLDER,
  CLOUDINARY_UPLOAD_TIMEOUT_MS,
  IMAGE_FETCH_BUDGET_MS,
  MAX_IMAGES,
} from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';
import { detectImageMimeType } from '#utils/imageType.js';
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

/**
 * The other direction: stored URLs back to bytes, for the classifier. PR 6a.2.
 *
 * **Why this lives here.** This file and `config/cloudinary.js` are the only two that
 * know which image host this project uses, and this file already owns a buffer in, a
 * URL out. A URL in, a buffer out is the same boundary read backwards — the transform
 * below is Cloudinary's syntax and belongs on the Cloudinary side of it, and
 * `llm.prompt.js` stays a pure function that formats parts and opens no sockets.
 *
 * **Why the bytes come here at all.** Gemini has no image-by-URL content part. A part
 * carries `inlineData` (base64 bytes) or `fileData` (a URI in Gemini's *own* Files API,
 * which is not a CDN), so the `{ type: 'image', uri }` this project sent for three
 * epics reached nothing. Inlining costs one fetch inside the request; the alternative
 * is a second storage system beside Cloudinary and a 48-hour file lifetime to reason
 * about. See the epic README for the trade, and 6a.3's p95 for whether it holds.
 *
 * **Nothing here is logged with a URL in it.** A Cloudinary URL is a pointer to a
 * student's homework, readable by anyone who has it. Drops are counted, never named.
 *
 * @param {string[]} urls                 stored image URLs, from a database column
 * @param {object} [options]
 * @param {number} [options.limit]        images to send at most — `MAX_IMAGES`
 * @param {number} [options.budgetMs]     the whole fetch's budget, shared
 * @param {AbortSignal} [options.signal]  the caller's, if the classification is abandoned
 * @returns {Promise<Array<{mimeType: string, base64: string}>>} never rejects
 */
export async function fetchImagesForClassification(urls, options = {}) {
  const { limit = MAX_IMAGES, budgetMs = IMAGE_FETCH_BUDGET_MS, signal } = options ?? {};

  // The `https://` filter and the cap are applied here now, and they are the same two
  // rules `llm.prompt.js` applied before the bytes moved. The list arrives from a
  // database column: one bad row must not fail a classification, and a fourth image is
  // one the student never uploaded.
  const candidates = (urls ?? [])
    .filter((url) => typeof url === 'string' && url.startsWith('https://'))
    .slice(0, limit);

  if (candidates.length === 0) return [];

  // One budget for all of them, not one each. They are independent, so they are fetched
  // concurrently and share the clock — three images at four seconds apiece would be a
  // timeout with no request ever made to the model.
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, budgetMs);

  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  try {
    const settled = await Promise.allSettled(
      candidates.map((url) => fetchOneImage(url, controller.signal)),
    );

    const images = settled
      .filter((result) => result.status === 'fulfilled' && result.value !== null)
      .map((result) => result.value);

    if (images.length < candidates.length) {
      // By count. A dead URL, a slow one and a PDF someone renamed all read the same
      // here, and the difference is not worth a student's homework in a log line.
      logger.warn('Classification images dropped', {
        dropped: candidates.length - images.length,
        requested: candidates.length,
        budgetMs,
      });
    }

    return images;
  } finally {
    // An unreferenced timer keeps the event loop alive, which is invisible in a server
    // that never exits and very visible in a test run that hangs after the last assert.
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * One image, or `null`.
 *
 * **Null rather than a throw, for every reason it can fail.** A 404, a timeout and a
 * file whose bytes are not an image are all "this classification has one fewer
 * photograph", and a classification that had two good ones must still happen.
 *
 * **The MIME comes from the bytes.** Not the URL's extension, and not the response's
 * `Content-Type` — a CDN's declared type is a claim, and this codebase decided at 3.2
 * that a claim about an image's type is not evidence (`middlewares/upload.js` reads the
 * bytes on the way in). `detectImageMimeType` is that same decision restated where the
 * bytes leave, so there is one answer in this codebase to "what is this image" and one
 * signature table behind it. Bytes it does not recognise are dropped rather than
 * guessed at: the allowlist is the rule, and a wrong declared type on an otherwise good
 * photograph is a classification failed for no reason.
 */
async function fetchOneImage(url, signal) {
  const response = await fetch(withClassificationTransform(url), { signal });

  if (!response.ok) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = detectImageMimeType(buffer);

  if (!mimeType) return null;

  return { mimeType, base64: buffer.toString('base64') };
}

/**
 * The delivery URL with the classification transform in it, where that means anything.
 *
 * Cloudinary reads transforms as the path segment after `/upload/`, so this is a string
 * edit and not an API call — no round trip, and the resize happens on their machines.
 *
 * Only for URLs on Cloudinary's delivery host. The column is Cloudinary's today, but it
 * is a column: a URL from anywhere else is fetched exactly as stored, because
 * `f_jpg,q_auto,w_1600` is a path segment this vendor understands and a 404 everywhere
 * else. That is also what keeps the MIME sniff meaningful — a non-Cloudinary URL is not
 * converted on the way out, so what its bytes say is what gets sent.
 */
function withClassificationTransform(url) {
  try {
    if (new URL(url).hostname !== CLOUDINARY_DELIVERY_HOST) return url;
  } catch {
    return url;
  }

  if (!url.includes('/upload/') || url.includes(CLOUDINARY_CLASSIFICATION_TRANSFORM)) return url;

  return url.replace('/upload/', `/upload/${CLOUDINARY_CLASSIFICATION_TRANSFORM}/`);
}
