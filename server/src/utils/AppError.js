import { ERROR_CODES, ERROR_STATUS } from '#config/errors/codes.js';

/**
 * The only error type this codebase throws deliberately. MVP.md §15.3.
 *
 * `isOperational` is the important field: it separates "the user did something we
 * anticipated" from "we have a bug". Operational errors return their own message
 * to the client; everything else returns a generic one and gets logged in full.
 *
 * The HTTP status is derived from the code by default, so a call site says what
 * went wrong rather than repeating which number represents it.
 */
export class AppError extends Error {
  /**
   * @param {string} code        one of ERROR_CODES
   * @param {string} message     safe to show the user
   * @param {number} [statusCode] overrides the code's default status
   * @param {*} [details]        field-level detail, e.g. Zod issues
   */
  constructor(code, message, statusCode, details = null) {
    super(message);

    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode ?? ERROR_STATUS[code] ?? 500;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace?.(this, AppError);
  }

  // ── shorthands for the codes thrown most often ──────────────────────────────

  static notFound(what = 'Resource') {
    return new AppError(ERROR_CODES.NOT_FOUND, `${what} not found.`);
  }

  static unauthorized(message = 'You need to be logged in.') {
    return new AppError(ERROR_CODES.UNAUTHORIZED, message);
  }

  static forbidden(message = 'You do not have access to this.') {
    return new AppError(ERROR_CODES.FORBIDDEN, message);
  }

  static validation(message = 'Some fields need fixing.', details = null) {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, message, undefined, details);
  }

  static internal(message = 'Something went wrong. Please try again.') {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, message);
  }

  static notImplemented(what = 'This endpoint') {
    return new AppError(ERROR_CODES.NOT_IMPLEMENTED, `${what} is not implemented yet.`);
  }
}
