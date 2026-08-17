import { prisma } from '#config/db.js';

/**
 * The one write behind `teacher_profiles.last_seen_at` — MVP.md §10, §13. PR 5.2.
 *
 * **A fourth repository rather than a query added to an existing one.** The column is
 * on `teacher_profiles`, which is neither a session nor an offer, so
 * `session.repository.js` and `offer.repository.js` would both have to be renamed to
 * stay honest. `teacher.repository.js` is E2's and frozen since 2.1. A small file with
 * an accurate name beats a large one with a convenient one, and
 * `git log --oneline -- <file>` — the only reviewer this epic has — then shows one PR
 * against it.
 *
 * **Nothing here reads `last_seen_at`.** The freshness rule has exactly one reader and
 * it is 5.5's sweep; a second one drifts from the first, and the two disagreeing about
 * when a teacher counts as away is a defect nothing in the test suite could see. This
 * file writes the column and never asks what is in it.
 */

/**
 * Moves a teacher's `last_seen_at` forward. Called from `presence.service.js` on a
 * heartbeat, on connect, and on a status change — never from a controller.
 *
 * **`updateMany`, not `update`, and the reason is not concurrency this time.** `update`
 * raises Prisma's `P2025` when it matches nothing, and the caller here is a socket
 * event handler with no request to fail: a teacher whose profile row was deleted under
 * a live token would turn a heartbeat into an unhandled rejection every interval,
 * forever. `updateMany` answers `{ count: 0 }` and the beat is a no-op, which is the
 * correct outcome for activity by a teacher who no longer has a row.
 *
 * The instant is passed in rather than defaulted to `new Date()` here, the same rule
 * `createOffer` follows: a repository that reads the clock is a repository making a
 * decision, and the decision about *when* a beat happened belongs with the debounce
 * that decided the beat was worth writing at all.
 *
 * @param {string} teacherId `teacher_profiles.user_id`
 * @param {Date} instant when the activity happened
 * @returns {Promise<{count: number}>} `0` means there is no profile row
 */
export async function touchLastSeenAt(teacherId, instant) {
  return prisma.teacherProfile.updateMany({
    where: { userId: teacherId },
    data: { lastSeenAt: instant },
  });
}
