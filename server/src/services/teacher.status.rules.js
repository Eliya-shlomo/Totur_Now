/**
 * Which manual availability changes a teacher is allowed to make — the rule on its own,
 * with no database under it.
 *
 * **Split out of `teacher.me.service.js` for the reason `presence.debounce.js` was split
 * out of `presence.service.js`:** `npm test` is bare `node --test` with no database, so a
 * test that imported the service would pull in the repository and therefore
 * `PrismaClient`. The rule this file holds is the part worth testing and the only part
 * with no I/O in it, so it lives where a test can reach it.
 *
 * Added by PR 5.10, after PR 5.9's verification pass found the missing case. It is a
 * predicate about status transitions and it exists because one was absent, which is
 * exactly the shape of thing that should have a test beside it.
 */

import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';

/**
 * The two statuses the system owns, and which a teacher may not put themselves back out
 * of by pressing their own availability pill.
 *
 * `OFFER_LOCKED` and `IN_SESSION` are written by `session.offer.service.js` and
 * `offer.respond.service.js`, and they are released by an accept, a reject or the expiry
 * sweep — never by the teacher directly. `presence.autoAway.job.js` already refuses to
 * move them, in a predicate written for this reason; this is the same rule on the manual
 * path, which is where it was missing.
 */
export const SYSTEM_OWNED_STATUSES = ['OFFER_LOCKED', 'IN_SESSION'];

/**
 * Refuses a manual move to `ONLINE` while an offer or a session holds the teacher.
 *
 * **Only `ONLINE` is refused, and `OFFLINE` deliberately is not.** Going offline
 * mid-offer is a supported thing to do — it is a teacher closing a laptop, PR 5.9's
 * checklist has a case for it, and it cannot manufacture a second offer because
 * `lockTeacherForOffer` matches on `ONLINE`. The conditional releases then do the right
 * thing on their own: `releaseTeacherLock`'s `where` refuses to move a teacher who is no
 * longer `OFFER_LOCKED`, so a reject leaves them `OFFLINE` rather than dragging them back
 * online.
 *
 * Setting `ONLINE` from `OFFER_LOCKED` is the one that breaks things, and it breaks the
 * epic's headline guarantee rather than something cosmetic: it releases a live lock
 * without resolving the offer, so a second student can be locked onto the same teacher
 * and `MVP.md` §11.3-A's "exactly one" becomes two `PENDING` offers on one teacher —
 * reached through a button rather than through any race.
 *
 * A no-op unless the `PATCH` actually carried a status: a request that only changed a bio
 * must not start failing because an offer happens to be open.
 *
 * @param {string} current  the row's status, before the write
 * @param {string} [next]   `payload.status`, absent on a `PATCH` that did not set one
 * @throws {AppError} TEACHER_UNAVAILABLE (409)
 */
export function assertStatusChangeAllowed(current, next) {
  if (next !== 'ONLINE') return;
  if (!SYSTEM_OWNED_STATUSES.includes(current)) return;

  throw new AppError(
    ERROR_CODES.TEACHER_UNAVAILABLE,
    current === 'IN_SESSION'
      ? 'You are in a session. Your availability comes back when it ends.'
      : 'You have a request waiting. Accept or decline it, or let it expire — your availability comes back on its own.',
  );
}
