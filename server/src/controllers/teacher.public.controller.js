import { AppError } from '#utils/AppError.js';

/**
 * What a student sees about a teacher — `GET /teachers` and `GET /teachers/:id`.
 *
 * **Stubs. Filled in by PR 2.3 (DEV-A), which owns this file.** The routes are
 * already wired in the frozen `teacher.routes.js` against these two names, so 2.3
 * replaces two function bodies and a validator and opens nothing DEV-B has open.
 *
 * No authentication on either route, deliberately: a stranger reads a teacher's
 * profile before deciding whether to register. That is also why the payload is
 * `toTeacherCard` and not `toTeacherMe` — no email, no `status`, no counter beyond
 * the rating pair.
 *
 * Both handlers reach 2.3's `teacher.public.service.js`, which resolves a price band
 * through `utils/pricing.js`, calls `findTeacherPage` or `findTeacherById`, and maps
 * the rows through the serializer. The service does not re-sort or re-fetch: the
 * repository already orders the page and already brings topics with it, and undoing
 * either reintroduces the epic's one N+1.
 *
 * Neither stub takes parameters. Express passes `(req, res, next)` regardless, and
 * arguments nothing reads are a lint error rather than documentation — the
 * signatures arrive with the bodies in 2.3.
 */

/**
 * `GET /teachers` — the filtered, paged public list.
 *
 * 2.3 returns `{ teachers, total }`: `total` is the unpaged count of everything the
 * filters match, so a client asking for `pageSize=1000` gets the cap in `teachers`
 * and the true size in `total`.
 */
export async function listTeachers() {
  throw AppError.notImplemented('GET /teachers');
}

/**
 * `GET /teachers/:id` — one card, or `NOT_FOUND`.
 *
 * A user id that exists but belongs to a student has no teacher profile: the
 * repository answers `null` and 2.3 turns that into `NOT_FOUND`, not a 500 and not
 * an empty card.
 */
export async function getTeacherById() {
  throw AppError.notImplemented('GET /teachers/:id');
}
