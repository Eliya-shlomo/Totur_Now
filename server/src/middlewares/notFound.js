import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';

/**
 * Registered after every router, before `errorHandler`.
 *
 * Without it Express answers an unmatched path with its own HTML page, which is
 * the one response in the application that does not match the shape in
 * CONVENTIONS.md — the client's axios interceptor would get HTML where it expects
 * `{ success: false, error: { code } }` and report a parse failure instead of a
 * 404. Handing a `NOT_FOUND` to the error middleware keeps every response, success
 * or failure, parsed by the same code path on the client.
 *
 * The method and path go in the message because the two people most likely to hit
 * this are the two writing the routers.
 */
export function notFound(req, res, next) {
  next(new AppError(ERROR_CODES.NOT_FOUND, `Cannot ${req.method} ${req.originalUrl}.`));
}
