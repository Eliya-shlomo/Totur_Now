import { AppError } from '#utils/AppError.js';

/**
 * `POST /auth/register`. **Stub — DEV-A replaces this file in PR 1.2.**
 *
 * The route is wired and reachable now, so the endpoint answers `501
 * NOT_IMPLEMENTED` in the standard error shape instead of `404 NOT_FOUND`. The
 * difference matters to whoever calls it first: a 501 says "this exists and is not
 * finished", a 404 says "you got the path wrong", and 1.3's screens will be written
 * against this URL before 1.2 lands.
 *
 * The export name is the contract with the frozen `auth.routes.js`. Replace the
 * body, keep the name.
 *
 * Layering, for whoever fills this in (CONVENTIONS.md): the controller reads `req`,
 * calls `auth.register.service.js`, and answers. It does not touch Prisma, and the
 * transaction lives in the service.
 */

/** Takes no parameters until 1.2 gives it a body — `asyncHandler` passes `(req, res, next)`. */
export function register() {
  throw AppError.notImplemented('POST /auth/register');
}
