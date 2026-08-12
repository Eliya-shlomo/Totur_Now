import { verifyAccessToken } from '#services/auth.token.service.js';
import { AppError } from '#utils/AppError.js';

/**
 * `Authorization: Bearer <access_token>` → `req.user`. MVP.md §12, §15.5.
 *
 * **Human-written, no agent** (MVP.md §17.5, OWNERSHIP.md §6). Read it line by line
 * in review: a bug here is silent, and it is silent in the direction that lets the
 * wrong person through.
 *
 * Two properties this file exists to guarantee:
 *
 * **No database round-trip.** The token is the proof; verifying its signature is
 * the check. This module imports no repository and no Prisma client, which is a
 * property you can confirm by reading the two import lines above. It runs on every
 * authenticated request, so a query here would be a query on every request in the
 * application. The cost is a 15-minute window in which a blocked user's existing
 * access token still works — that is why the access TTL is short, and why E9 blocks
 * users at login and refresh rather than here.
 *
 * **It never answers.** It throws `AppError` and lets `errorHandler` produce the
 * response, so an auth failure has the same body shape as every other failure and
 * is logged by the same code. A `res.status(401)` in this file would be a second,
 * subtly different error format that the client would have to special-case.
 *
 * `req.user` is `{ id, role }` and nothing more. Anything else a handler needs about
 * the user, it loads — `GET /auth/me` (1.4) exists for exactly that.
 */

/**
 * Pulls the bearer token out of the header, or throws `UNAUTHORIZED`.
 *
 * Missing, empty, wrong scheme and "two tokens" all mean the same thing: no
 * credentials were presented. That is `UNAUTHORIZED`, not `TOKEN_INVALID` — the
 * latter says "you presented a token and it is not trustworthy", which the client
 * (1.5) reads as a reason to log out. A caller that simply forgot the header must
 * not trip that.
 *
 * The scheme is compared case-insensitively per RFC 7235, which defines auth
 * scheme names as case-insensitive; the token itself is taken verbatim.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function bearerToken(req) {
  const header = req.headers.authorization;

  if (!header) {
    throw AppError.unauthorized();
  }

  const parts = header.trim().split(' ');

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    throw AppError.unauthorized();
  }

  return parts[1];
}

/**
 * Requires a valid access token. Attaches `req.user = { id, role }`.
 *
 * Not `async`, and deliberately not wrapped in `asyncHandler`: nothing here awaits,
 * and Express already forwards a synchronous throw from a middleware to the error
 * handler. Wrapping it would only hide that.
 *
 * @throws {AppError} UNAUTHORIZED (no credentials) | TOKEN_INVALID | TOKEN_EXPIRED
 */
export function authenticate(req, res, next) {
  req.user = verifyAccessToken(bearerToken(req));
  next();
}

/**
 * Attaches `req.user` when a valid token is present, and otherwise carries on with
 * `req.user` unset. Never throws for an auth reason.
 *
 * Exactly one route uses this: `POST /auth/logout`. Logging out must work with an
 * access token that expired while the tab sat open — the refresh cookie is what
 * actually gets cleared, and refusing the request would leave that cookie alive for
 * its full seven days on the machine of someone who just pressed "log out". The
 * handler in 1.4 clears the cookie unconditionally and uses `req.user` only for the
 * log line.
 *
 * This is not a general-purpose "optional auth". Anything that reads user data uses
 * `authenticate`, so that a token which fails verification is a 401 rather than a
 * silent downgrade to an anonymous response.
 */
export function authenticateOptional(req, res, next) {
  try {
    req.user = verifyAccessToken(bearerToken(req));
  } catch {
    // Expired, tampered, or absent — all the same answer here: no `req.user`.
    // Swallowed on purpose, and only on the one route that cannot need it.
  }

  next();
}
