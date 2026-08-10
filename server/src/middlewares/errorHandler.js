import { ZodError } from 'zod';
import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';
import { fieldErrors } from '#utils/fieldErrors.js';
import { logger } from '#utils/logger.js';
import { env } from '#config/env.js';

/**
 * The last middleware in the stack. MVP.md §15.3.
 *
 * Two rules it exists to enforce:
 *   1. every response has the same shape, so the client parses one thing
 *   2. an unexpected error never leaks its message, stack, or SQL to the client
 *
 * Express identifies error middleware by arity — the unused `next` must stay.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const error = normalize(err);

  if (!error.isOperational) {
    // A bug, not a user mistake. Log everything we have.
    logger.error(error.message, {
      code: error.code,
      path: req.originalUrl,
      method: req.method,
      userId: req.user?.id,
      stack: error.stack,
    });
  } else {
    logger.debug(`${error.code} on ${req.method} ${req.originalUrl}`, {
      userId: req.user?.id,
    });
  }

  const body = {
    success: false,
    error: {
      code: error.code,
      message: error.isOperational ? error.message : 'Something went wrong. Please try again.',
      details: error.details ?? null,
    },
  };

  // Never in production: the stack is for us, not for whoever is calling.
  if (!env.isProduction && !error.isOperational) {
    body.error.stack = error.stack;
  }

  res.status(error.statusCode).json(body);
}

/**
 * Turns anything thrown into an AppError.
 *
 * Zod and Prisma get translated here rather than at each call site, so a service
 * can let a validation or constraint failure propagate and still produce the right
 * client-facing code.
 */
function normalize(err) {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return AppError.validation('Some fields need fixing.', fieldErrors(err));
  }

  // Prisma known request errors carry a `code` like P2002. Matched structurally so
  // this file does not have to import @prisma/client.
  if (err?.code === 'P2002') {
    const target = err.meta?.target;
    const field = Array.isArray(target) ? target[0] : target;
    return AppError.validation(
      'That value is already taken.',
      field ? { [field]: 'Already in use.' } : null,
    );
  }

  if (err?.code === 'P2025') {
    return AppError.notFound();
  }

  if (err?.type === 'entity.parse.failed') {
    return AppError.validation('Request body is not valid JSON.');
  }

  // Anything else is a bug. Keep the original message for the log, not the response.
  const wrapped = new AppError(ERROR_CODES.INTERNAL_ERROR, err?.message ?? 'Unknown error', 500);
  wrapped.isOperational = false;
  wrapped.stack = err?.stack ?? wrapped.stack;
  return wrapped;
}
