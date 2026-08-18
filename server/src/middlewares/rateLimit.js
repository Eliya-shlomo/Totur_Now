import rateLimit from 'express-rate-limit';

import { RATE_LIMIT } from '#config/constants/index.js';
import { env } from '#config/env.js';
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

/**
 * How much the strict budget is multiplied by outside production.
 *
 * **Ten requests per fifteen minutes is a production number and it makes the app
 * untestable locally.** One developer on one machine is one IP: a few logins, a
 * re-registration and three questions is the entire budget, and what follows is a red
 * "Too many requests" on the ask screen with nothing wrong except that somebody was
 * working. §15.5's number is about a stranger on the internet, and the whole reason it
 * is written down is worth keeping — so the limiter stays wired in every environment
 * and only the budget moves. A runaway loop in development still trips it, three orders
 * of magnitude later.
 *
 * Not `skip`, deliberately: a limiter that is switched off locally is a limiter nobody
 * exercises until production, and the 429 body's shape is part of the contract.
 */
const DEV_BUDGET_MULTIPLIER = 50;

/** The production number, or a working developer's version of it. */
function limitFor(max) {
  return env.isProduction ? max : max * DEV_BUDGET_MULTIPLIER;
}

export const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT.global.windowMs,
  limit: limitFor(RATE_LIMIT.global.max),
  ...shared,
});

/**
 * The strict limiter, **and every route that mounts it gets its own counter.**
 *
 * It used to be one instance shared by `POST /auth/login`, `POST /auth/register` and
 * `POST /questions`, which means one budget for three unrelated things: logging in
 * during testing spent the questions a student could ask, and the 429 arrived on a
 * screen that had made one request. Signing in is not evidence that somebody is
 * abusing question creation.
 *
 * A factory, so each mount is a separate `rateLimit` instance with a separate store.
 * The exported `strictLimiter` stays for the two frozen auth routes that already import
 * it by name; anything new asks for its own.
 *
 * @param {number} [max] requests per window, before the development multiplier
 * @returns {import('express').RequestHandler}
 */
export function makeStrictLimiter(max = RATE_LIMIT.strict.max) {
  return rateLimit({
    windowMs: RATE_LIMIT.strict.windowMs,
    limit: limitFor(max),
    ...shared,
  });
}

export const strictLimiter = makeStrictLimiter();
