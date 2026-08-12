import { AppError } from '#utils/AppError.js';

/**
 * The session endpoints — login, refresh, logout, me.
 * **Stubs — DEV-B replaces this file in PR 1.4.**
 *
 * All four are wired in the frozen `auth.routes.js` and answer `501 NOT_IMPLEMENTED`
 * until then, so PR 1.5's client work has real URLs to build against immediately.
 * The four export names are the contract; replace the bodies, keep the names.
 *
 * Notes for 1.4, so the shape does not have to be rediscovered:
 *
 * - `login` responds `{ user, accessToken }` **and** `setRefreshCookie(res, ...)` —
 *   field-identical to what 1.2's register returns. That is the epic's stated risk.
 * - `refresh` reads the cookie by `REFRESH_COOKIE_NAME`, verifies it with
 *   `verifyRefreshToken`, and rotates it: new access token, new refresh cookie.
 *   Either `TOKEN_*` code coming back means clear the cookie and answer
 *   `UNAUTHORIZED` — the client needs one unambiguous "log in again" signal.
 * - `logout` runs behind `authenticateOptional`, so `req.user` may be undefined
 *   when the access token expired in an idle tab. Clear the cookie regardless and
 *   answer 200; logging out twice is not an error.
 * - `me` runs behind `authenticate`, so `req.user` is always `{ id, role }` here.
 */

export function login() {
  throw AppError.notImplemented('POST /auth/login');
}

export function refresh() {
  throw AppError.notImplemented('POST /auth/refresh');
}

export function logout() {
  throw AppError.notImplemented('POST /auth/logout');
}

export function me() {
  throw AppError.notImplemented('GET /auth/me');
}
