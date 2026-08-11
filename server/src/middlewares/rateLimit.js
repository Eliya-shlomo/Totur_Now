import rateLimit from 'express-rate-limit';

import { RATE_LIMIT } from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';

/**
 * Rate limiting. MVP.md §15.5, windows and counts from `constants/auth.js`.
 *
 * Two limiters, and only one of them is applied in `app.js`:
 *
 *   globalLimiter — a blanket backstop on `/api/v1`, generous enough that a real
 *                   user never meets it.
 *   strictLimiter — exported and deliberately left unwired. It belongs on login,
 *                   register and question creation, and those routes do not exist
 *                   yet. Their epics apply it in their own routers, because the
 *                   alternative is `app.js` knowing route paths — and `app.js` is
 *                   frozen after this PR (OWNERSHIP.md §2).
 */

/**
 * Both limiters answer in the shape from CONVENTIONS.md rather than
 * express-rate-limit's default plain-text body. Handing the error to `next`
 * instead of writing the response here means the 429 is logged and serialised by
 * the same middleware as every other error.
 */
function reject(req, res, next) {
  next(new AppError(ERROR_CODES.RATE_LIMITED, 'Too many requests. Please slow down.'));
}

const shared = {
  // `RateLimit-*` headers per the IETF draft; the legacy `X-RateLimit-*` set is
  // off because nothing here reads it and two header families saying the same
  // thing is just noise.
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: reject,
};

export const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT.global.windowMs,
  limit: RATE_LIMIT.global.max,
  ...shared,
});

export const strictLimiter = rateLimit({
  windowMs: RATE_LIMIT.strict.windowMs,
  limit: RATE_LIMIT.strict.max,
  ...shared,
});
