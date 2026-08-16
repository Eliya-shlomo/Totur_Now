import multer from 'multer';

import {
  ALLOWED_IMAGE_MIME_TYPES,
  ATTACHMENT_FIELD_NAME,
  MAX_IMAGE_BYTES,
} from '#config/constants/index.js';
import { AppError } from '#utils/AppError.js';
import { detectImageMimeType } from '#utils/imageType.js';

/**
 * Multipart file intake for `POST /questions/attachments`. MVP.md §12, PR 3.2.
 *
 * The route was frozen in 3.1 against `upload.single(ATTACHMENT_FIELD_NAME)`, and
 * that line has not moved — this PR replaced the pass-through body behind it. That
 * was the whole point of shipping the file early: the first PR after a freeze did not
 * have to open the frozen router.
 *
 * **What reaches the controller is a file that has already been proved to be an
 * allowed image.** Three checks, in the order that costs the least:
 *
 *   1. `fileFilter` — the *declared* type, before a single byte is buffered. A PDF
 *      announced as a PDF is refused without being read.
 *   2. `limits` — the size cap and one file per request, enforced by Multer as it
 *      reads, so an oversized upload stops mid-stream instead of after.
 *   3. `detectImageMimeType` — the *actual* type, from the bytes, once they are in
 *      hand. This is the check that matters: a `.txt` renamed to `.jpg` is announced
 *      by curl and by every browser as `image/jpeg`, so step 1 passes it. See
 *      `utils/imageType.js`.
 *
 * `req.file.mimetype` is overwritten with the detected type, so what is stored is
 * what the bytes are and no later reader has to wonder which of the two it is
 * holding.
 *
 * **Memory storage, not disk.** `multer({ dest })` writes to a filesystem that does
 * not survive a Render restart and that the free tier charges for; the buffer goes
 * straight to Cloudinary and is never a file on this machine. It also means the size
 * cap is a memory bound, which is the other reason it is not generous.
 *
 * **No Multer error reaches `errorHandler` as a stranger.** Multer throws its own
 * `MulterError` class with messages like `File too large` — not the project's shape,
 * and not a sentence anyone would want a student to read. They are translated here,
 * at the boundary, exactly as `validate.js` translates Zod.
 */

const parser = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_IMAGE_BYTES,
    // One image per request. The *per question* cap is MAX_ATTACHMENTS and belongs to
    // `POST /questions`, which is the only place that knows how many a question
    // already has.
    files: 1,
  },

  /**
   * The declared type, checked against the allowlist before the body is read.
   *
   * A cheap first gate and nothing more — this header is written by the uploader.
   * Rejecting with an `AppError` rather than `cb(null, false)`: the `false` form
   * silently drops the file and leaves `req.file` undefined, which would surface as
   * "no file sent" and send the student looking for a bug in their file picker.
   */
  fileFilter(_req, file, cb) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return cb(unsupportedType());
    }

    return cb(null, true);
  },
});

/**
 * The Multer-shaped object the frozen router calls.
 *
 * `single(fieldName)` wraps Multer's own middleware so that everything after it can
 * assume `req.file` exists and holds an allowed image. The wrapper is what makes the
 * translation possible at all: Multer reports failures through its callback, not by
 * throwing, so `asyncHandler` would never see them.
 */
export const upload = {
  single(fieldName) {
    const parseOne = parser.single(fieldName);

    return function parseSingleUpload(req, res, next) {
      parseOne(req, res, (error) => {
        if (error) return next(translate(error));

        // Multer treats "no file at all" as success. It is a client bug, and a
        // controller left to discover it would answer with a 500 about a property of
        // undefined.
        if (!req.file) return next(missingFile(fieldName));

        const detected = detectImageMimeType(req.file.buffer);
        if (!detected) return next(unsupportedType());

        req.file.mimetype = detected;
        return next();
      });
    };
  },
};

/**
 * Multer's errors, in this project's shape.
 *
 * Matched on `code`, which is Multer's stable identifier, rather than on the English
 * message, which is not. An `AppError` passes through untouched — that is the
 * `fileFilter` rejection above coming back out through the same callback.
 */
function translate(error) {
  if (error instanceof AppError) return error;

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return fieldError(`That image is too large. The limit is ${megabytes(MAX_IMAGE_BYTES)} MB.`);
  }

  // Wrong field name and a second file arrive as the same code: Multer accepted one
  // field and met something it was not expecting.
  if (error?.code === 'LIMIT_UNEXPECTED_FILE' || error?.code === 'LIMIT_FILE_COUNT') {
    return missingFile(ATTACHMENT_FIELD_NAME);
  }

  // Any other MulterError — a malformed multipart body, a part count limit. The
  // client sent something we cannot read, which is a 400 and not a 500, but its
  // message is Multer's and does not leave this function.
  return fieldError('That upload could not be read. Send one image file.');
}

function missingFile(fieldName) {
  return fieldError(`Attach exactly one image, in a field named "${fieldName}".`);
}

function unsupportedType() {
  return fieldError(`Images only, and only these: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}.`);
}

/** Every failure here is about one field, so every failure names it the same way. */
function fieldError(message) {
  return AppError.validation(message, { [ATTACHMENT_FIELD_NAME]: message });
}

/** Bytes are the rule; megabytes are what a person reading the message understands. */
function megabytes(bytes) {
  return Math.round(bytes / 1024 / 1024);
}
