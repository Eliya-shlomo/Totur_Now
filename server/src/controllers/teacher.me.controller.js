import { AppError } from '#utils/AppError.js';

/**
 * The teacher's own record — `GET` and `PATCH /teachers/me`.
 *
 * **Stubs. Filled in by PR 2.2 (DEV-B), which owns this file.** The route,
 * the middleware chain and the validator are already wired in the frozen
 * `teacher.routes.js`, so 2.2 replaces two function bodies and opens nothing
 * shared. That is the whole trick this PR is buying.
 *
 * `NOT_IMPLEMENTED` (501) rather than a missing route: a 404 says the endpoint does
 * not exist, and the client work in 2.4 needs the difference between "not built
 * yet" and "you called the wrong URL" while both are true at once.
 *
 * Both handlers reach 2.2's `teacher.me.service.js`, which reaches
 * `teacher.repository.js` and serializes through `toTeacherMe`. Neither ever imports
 * Prisma — controllers do not touch the database (CONVENTIONS.md → Server layering).
 *
 * There is no ownership parameter and there will not be one. The teacher being read
 * or written is always `req.user.id`; `authorize('teacher')` in the router is what
 * makes that safe, and `PATCH /teachers/:id` does not exist.
 *
 * Both stubs take no parameters. Express passes `(req, res, next)` regardless, and
 * declaring arguments nothing reads is a lint error rather than documentation — the
 * signature arrives with the body in 2.2.
 */

/**
 * `GET /teachers/me` — the authenticated teacher's own record.
 *
 * 2.2 returns `toTeacherMe` of `findTeacherById(req.user.id)`. It is the stepper's
 * source of truth for which steps are done, so it has to be right on a brand-new
 * teacher whose row is registration defaults and nothing else.
 */
export async function getMe() {
  throw AppError.notImplemented('GET /teachers/me');
}

/**
 * `PATCH /teachers/me` — bio, price, level, topics, status. Always a partial.
 *
 * 2.2 validates, then calls `updateTeacherProfile(req.user.id, { data, topicIds })`
 * — one transaction, with `topicIds` replacing the whole set — and returns the
 * updated record in the same shape `GET` returns.
 */
export async function patchMe() {
  throw AppError.notImplemented('PATCH /teachers/me');
}
