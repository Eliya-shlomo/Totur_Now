import jwt from 'jsonwebtoken';

import {
  ACCESS_TOKEN_TTL,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL,
  REFRESH_TOKEN_TTL_SECONDS,
} from '#config/constants/index.js';
import { env } from '#config/env.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';

/**
 * Signing, verification and the refresh cookie. MVP.md §15.5, and the token
 * strategy frozen in `docs/epics/E1-auth/README.md`.
 *
 * Two secrets, never one. A leaked access secret must not be able to mint refresh
 * tokens, and because the two token types are verified against different keys, a
 * refresh token presented as an access token fails on the signature — there is no
 * need for a `typ` claim to tell them apart, and adding one would put a fifth field
 * in a payload the epic froze at four.
 *
 * Both secrets come from `#config/env.js`, which is validated at boot and has no
 * default for either. A missing `JWT_ACCESS_SECRET` stops the process on startup;
 * it can never fall back to a development value that then ships.
 *
 * **Deliberate deviation from CONVENTIONS.md** ("services never know about
 * `req`/`res`"): `setRefreshCookie` and `clearRefreshCookie` take `res`. The cookie
 * flags are part of the token strategy, not of any one endpoint, and PR 1.2 and PR
 * 1.4 both set this cookie. Two copies of these flags in two controllers is exactly
 * the divergence the epic README lists as a risk, so they live here, next to the
 * TTL they encode. Nothing else in this file touches `req` or `res`.
 */

// ── signing ──────────────────────────────────────────────────────────────────

/**
 * The access token. 15 minutes, returned in the response body, held in memory by
 * the client — never in `localStorage` (§15.5).
 *
 * `jsonwebtoken` adds `iat` and `exp` itself, so the payload on the wire is exactly
 * `{ sub, role, iat, exp }`. Nothing else goes in: the token is not a profile cache,
 * and a name or email baked into it would be stale the moment the user edits it.
 *
 * @param {{ id: string, role: string }} user
 * @returns {string}
 */
export function signAccessToken(user) {
  //function gets a user object
  //returns a jwt lasting for 15 mins
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

/**
 * The refresh token. 7 days, and it only ever travels in the httpOnly cookie below.
 * Same payload as the access token, different secret and TTL.
 *
 * @param {{ id: string, role: string }} user
 * @returns {string}
 */
export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

// ── verification ─────────────────────────────────────────────────────────────

/**
 * Verifies a token and returns the identity in the shape the rest of the codebase
 * uses — `{ id, role }`, not raw claims. Callers never see `sub`.
 *
 * The expired / invalid split is the whole reason this returns distinct codes:
 * PR 1.5's axios interceptor refreshes on `TOKEN_EXPIRED` and logs the user out on
 * `TOKEN_INVALID`. Collapsing both into `UNAUTHORIZED` would mean either logging
 * users out every fifteen minutes or retrying forever against a tampered token.
 *
 * @throws {AppError} TOKEN_EXPIRED | TOKEN_INVALID
 */
function verify(token, secret) {
  //token is the jwt to verify, secret is the secret to verify against
  let payload; //payload is the decoded token payload after verification

  try {
    payload = jwt.verify(token, secret); //verify the token using the provided secret
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Your session has expired.');
    }
    // JsonWebTokenError (bad signature, malformed) and NotBeforeError both land
    // here. From the client's point of view they are the same event: this token
    // cannot be trusted and refreshing will not help.
    throw new AppError(ERROR_CODES.TOKEN_INVALID, 'That session token is not valid.');
  }

  // A token can carry our signature and still be the wrong shape — an older token
  // format, or one minted by a future feature. Checked rather than assumed, because
  // `req.user.id` being `undefined` downstream is a bug that surfaces far from here.
  if (typeof payload?.sub !== 'string' || typeof payload?.role !== 'string') {
    throw new AppError(ERROR_CODES.TOKEN_INVALID, 'That session token is not valid.');
  }

  return { id: payload.sub, role: payload.role }; //if now errors, return the user id and role from the payload
}

/**
 * @param {string} token
 * @returns {{ id: string, role: string }}
 * @throws {AppError} TOKEN_EXPIRED | TOKEN_INVALID
 */
export function verifyAccessToken(token) {
  return verify(token, env.JWT_ACCESS_SECRET);
}

/**
 * Same contract as `verifyAccessToken`, against the refresh secret.
 *
 * PR 1.4 catches both codes on `POST /auth/refresh`, clears the cookie and answers
 * `UNAUTHORIZED` — an unusable refresh token is a "log in again" for the client
 * whether it expired or was tampered with, and there is nothing left to refresh
 * with in either case.
 *
 * @param {string} token
 * @returns {{ id: string, role: string }}
 * @throws {AppError} TOKEN_EXPIRED | TOKEN_INVALID
 */
export function verifyRefreshToken(token) {
  return verify(token, env.JWT_REFRESH_SECRET);
}

// ── the refresh cookie ───────────────────────────────────────────────────────

/**
 * One builder for both helpers, so that what `clearCookie` sends is byte-identical
 * to what `cookie` set. A cookie's identity is name + domain + path; clearing it
 * with a different `path` leaves the original in the browser and the user stays
 * logged in after pressing log out.
 *
 * `sameSite` is the environment-dependent part, and getting it wrong is the failure
 * mode the epic README calls out. In production the client is on Vercel and the API
 * on Render — different registrable domains, so the refresh request is cross-site
 * and only `'none'` lets the browser attach the cookie. Locally both sides are
 * `localhost`, which is same-site, and `'lax'` is the tighter choice available there.
 *
 * `secure` is always on. `'none'` without it is rejected outright by every current
 * browser, and on `http://localhost` it costs nothing: localhost is a trustworthy
 * origin, so Secure cookies work there without TLS. (Developing over a LAN IP
 * instead of localhost is the one case where this bites.)
 */
function refreshCookieOptions() {
  return {
    // Not readable by JavaScript — the whole point of keeping the long-lived token
    // out of the client bundle's reach (§15.5).
    httpOnly: true,
    secure: true,
    sameSite: env.isProduction ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
  };
}

/**
 * Sets the refresh cookie. Used by register (1.2), login and refresh rotation (1.4).
 *
 * `maxAge` is in milliseconds and is set only here — `clearCookie` must not carry
 * one, since it sets its own expiry in the past.
 *
 * @param {import('express').Response} res
 * @param {string} token
 */
export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    // The cookie flags are in `refreshCookieOptions()`, and the TTL is here. The
    // cookie is the only place the refresh token ever travels, so this is the only
    // place the TTL matters.
    ...refreshCookieOptions(),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

/**
 * Removes the refresh cookie. Used by logout and by a failed refresh (1.4).
 *
 * @param {import('express').Response} res
 */
export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}
