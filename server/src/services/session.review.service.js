import { prisma } from '#config/db.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { applyReviewAggregates, createReview } from '#repositories/review.repository.js';
import { findSessionForMeter, setSessionRated } from '#repositories/session.repository.js';
import { assertTransition } from '#services/session.state.js';
import { AppError } from '#utils/AppError.js';

/**
 * The rating, and the only way a session in this product reaches a terminal state. PR 6.6,
 * MVP.md §6.2, §10's `ENDED → RATED` edge and §12.
 *
 * ## Why the write is E6's when every reader of it is E8's
 *
 * §10 makes the rating mandatory, so without this edge no session ever leaves `ENDED` and
 * E8 inherits a table nobody can close. The write is thirty lines. **The badge, the
 * history screen and the public profile are all E8's and none of them is here** — this
 * file is the writer, E4's ranking is the reader, and between the two there is nothing in
 * E6.
 *
 * ## One transaction, and the counters are the reason
 *
 * ```
 *   BEGIN
 *     1. findSessionForMeter(sessionId, tx)     SELECT … FOR UPDATE OF s
 *     2. the caller is this session's student   else NOT_FOUND
 *     3. assertTransition(status, 'RATED')      ENDED is the only legal from
 *     4. insert reviews                         P2002 => SESSION_NOT_ACTIVE, 409
 *     5. teacher_profiles: the three counters
 *     6. session → RATED                        count 0 => SESSION_NOT_ACTIVE
 *   COMMIT
 * ```
 *
 * A review row that exists while `resolved_count` does not is a KPI that under-reports for
 * ever, and unlike the ledger there is no reconciliation query that would ever find it.
 * One transaction, or the numbers are decorative.
 *
 * **`NO_SHOW` cannot be rated and the table is what says so.** §10 draws no arrow out of
 * it, so step 3 refuses it without this file naming the status at all.
 *
 * ## The one line that decides whether every average in the product is right
 *
 * ```js
 * ratingCount: stars == null ? 0 : 1
 * ```
 *
 * `rating_sum += stars ?? 0` beside an unconditional `rating_count += 1` is the defect,
 * and it is one character away from being written: it makes every review with no stars
 * count as a zero-star one and drags a teacher's average down for the life of their
 * account. `isResolved` is required and `stars` is not, so unrated reviews are the common
 * case rather than the edge.
 */
const defaultDeps = {
  runTransaction: (fn) => prisma.$transaction(fn),
  lockSession: findSessionForMeter,
  saveReview: createReview,
  moveAggregates: applyReviewAggregates,
  markRated: setSessionRated,
};

/** Prisma's unique-constraint violation. `reviews.session_id` is the constraint. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Writes the review and closes the session.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.studentId the caller, from `req.user.id`
 * @param {boolean} input.isResolved §6.2's core KPI, and the one required field
 * @param {number} [input.stars] 1–5, validated by `reviewSchema` and by a `CHECK`
 * @param {string} [input.comment]
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{sessionId: string, status: 'RATED', isRated: true}>}
 */
export async function submitSessionReview(
  { sessionId, studentId, isResolved, stars, comment },
  deps = defaultDeps,
) {
  const { runTransaction, lockSession, saveReview, moveAggregates, markRated } = {
    ...defaultDeps,
    ...deps,
  };

  await runTransaction(async (tx) => {
    const locked = await lockSession(sessionId, tx);

    // The teacher does not rate the student — §10 has no arrow the other way — and a
    // stranger gets what a missing session gets.
    if (!locked || locked.studentId !== studentId) {
      throw AppError.notFound('Session');
    }

    // `ENDED` is the only legal `from`, so this one assert refuses a session still
    // running, one already rated, and a `NO_SHOW` that nobody should be rating.
    assertTransition(locked.status, 'RATED');

    await insertReview(
      { saveReview, sessionId, studentId, teacherId: locked.teacherId, isResolved, stars, comment },
      tx,
    );

    await moveAggregates(
      {
        teacherId: locked.teacherId,
        resolvedCount: isResolved ? 1 : 0,
        ratingSum: stars ?? 0,
        // **`0` when no stars were given.** The line this whole file is careful about.
        ratingCount: stars == null ? 0 : 1,
      },
      tx,
    );

    const { count } = await markRated(sessionId, tx);

    // The row moved out of `ENDED` between the lock and the write. Under the lock this is
    // unreachable, and it stays here for the same reason every conditional write in this
    // epic does: the assert and the `where` answer two different questions, and either
    // alone leaves one failure silent.
    if (count === 0) {
      throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, 'This session has already been rated.');
    }
  });

  return { sessionId, status: 'RATED', isRated: true };
}

/**
 * The insert, with the unique constraint read as an answer rather than as a crash.
 *
 * `reviews.session_id` is `UNIQUE`, which is the database saying one review per session —
 * a stronger guarantee than any `SELECT` this service could run, because a `SELECT` races
 * the insert it is guarding. So the constraint is left to do the refusing and its `P2002`
 * is translated here.
 *
 * **Unmapped it reaches `errorHandler` as a 500 for a double-tapped submit button**, which
 * is 6.6's review checklist verbatim, and a 500 is what tells a student the product is
 * broken when what happened is that their review was already saved.
 */
async function insertReview(
  { saveReview, sessionId, studentId, teacherId, isResolved, stars, comment },
  tx,
) {
  try {
    return await saveReview(
      {
        sessionId,
        studentId,
        teacherId,
        isResolved,
        stars: stars ?? null,
        comment: comment ?? null,
      },
      tx,
    );
  } catch (error) {
    if (error?.code === UNIQUE_VIOLATION) {
      throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, 'This session has already been rated.');
    }

    throw error;
  }
}
