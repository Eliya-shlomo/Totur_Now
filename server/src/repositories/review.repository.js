/**
 * The rating — one insert and one aggregate write. PR 6.6, MVP.md §6.2 and §11.2.
 *
 * **A file of its own, and the alternative was worse.** The aggregates belong to
 * `teacher_profiles`, but the only repository that writes that table today is
 * `teacher.presence.repository.js` — E5's, and it is about `status` and `last_seen_at`,
 * two columns whose whole purpose is that they change every few seconds. Putting a
 * rating's counters there would mean one file where a heartbeat and a permanent
 * reputation write live side by side. `session.repository.js` was the other candidate and
 * it already carries the epic's whole read/write set.
 *
 * So: reviews and the four columns a review moves, in one place, written by one service.
 *
 * **Both functions take a `tx`.** The insert and the counters are one transaction with
 * the session's own `RATED` write — a review that exists while `resolved_count` does not
 * is a KPI that under-reports for ever, and there is no reconciliation query that would
 * find it.
 *
 * **Everything that *reads* these columns is E8's.** The badge, the history screen, the
 * public profile. This file is the writer and E4's ranking is the reader, and between
 * them there is nothing in E6.
 */

/**
 * One row in `reviews`. **The database is what enforces one review per session** —
 * `session_id` is `UNIQUE` — and this insert is deliberately unguarded so that the
 * constraint is the thing that refuses a double submit rather than a `SELECT` that could
 * race it.
 *
 * A `P2002` from here is the second click, not a bug. The service catches it by code and
 * answers `409`; unmapped it would reach `errorHandler` as a 500 for a double-tapped
 * button.
 *
 * `stars` and `comment` are both optional in §11.2 and both arrive as `null` rather than
 * `undefined` when the student volunteered neither — the column is what says "no stars",
 * and a missing key and an explicit null must not be different rows.
 *
 * `CHECK (stars BETWEEN 1 AND 5)` sits under this and is the last line; `reviewSchema` is
 * the first.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.studentId
 * @param {string} params.teacherId
 * @param {boolean} params.isResolved §6.2's core KPI, and the one required field
 * @param {number|null} [params.stars] 1–5, or null
 * @param {string|null} [params.comment]
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the created row
 */
export async function createReview(
  { sessionId, studentId, teacherId, isResolved, stars = null, comment = null },
  tx,
) {
  return tx.review.create({
    data: { sessionId, studentId, teacherId, isResolved, stars, comment },
  });
}

/**
 * The four columns a rating moves, in one statement — 6.6, and **the first writer any of
 * them has ever had.**
 *
 * **Every increment arrives as a number and none is computed here.** `resolvedCount` is
 * `1` or `0`, `ratingSum` is the stars or `0`, and `ratingCount` is `1` only when stars
 * were given. The service decides all three, because the rule that decides them is §6.2's
 * and lives with the other product rules — and because `rating_sum += stars ?? 0` beside
 * an unconditional `rating_count += 1` is the defect this arrangement exists to make
 * visible: it turns every unrated review into a zero-star one and drags a teacher's
 * average down for the life of the account.
 *
 * `update` rather than `updateMany`: `userId` is the primary key and a teacher whose
 * profile has vanished mid-transaction is `P2025` — an error, not a silent zero. Every
 * other write in this epic is conditional because it is racing something; this one races
 * nothing, because the session's `ENDED → RATED` edge has already been won under a lock
 * by the time it runs.
 *
 * @param {object} params
 * @param {string} params.teacherId
 * @param {number} params.resolvedCount `1` when the student said it was solved
 * @param {number} params.ratingSum     the stars given, or `0`
 * @param {number} params.ratingCount   `1` when stars were given, **`0` when they were not**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the updated profile
 */
export async function applyReviewAggregates(
  { teacherId, resolvedCount, ratingSum, ratingCount },
  tx,
) {
  return tx.teacherProfile.update({
    where: { userId: teacherId },
    data: {
      resolvedCount: { increment: resolvedCount },
      ratingSum: { increment: ratingSum },
      ratingCount: { increment: ratingCount },
    },
  });
}
