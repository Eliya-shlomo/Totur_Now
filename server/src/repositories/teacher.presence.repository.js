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
 * **The freshness rule has exactly one reader, and PR 5.5 added it below.** 5.2 wrote
 * that nothing here reads `last_seen_at`, because a second reader drifts from the first
 * and two of them disagreeing about when a teacher counts as away is a defect nothing
 * in the test suite could see. That is still the rule; what changed is where the one
 * reader lives. `sweepIdleTeachers` is it, and it is here rather than in a fifth
 * repository because the column it reads is the column this file writes — a reader in
 * another file is exactly the drift 5.2 was guarding against.
 *
 * **Nothing in `presence.service.js` may call it.** The write path and the sweep are
 * the two ends of the same rule and they are allowed to meet only in the column.
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

/**
 * Takes a teacher offline, **only from `ONLINE`.** Added by the presence fix on top of
 * 5.8.
 *
 * ```sql
 * UPDATE teacher_profiles SET status = 'OFFLINE' WHERE user_id = $1 AND status = 'ONLINE'
 * ```
 *
 * The predicate is the whole point and it is the same shape `releaseTeacherLock` and
 * `sweepIdleTeachers` use. `OFFER_LOCKED` and `IN_SESSION` are states the *system* put
 * the teacher in, and a logout or a closed laptop must not clear them: the offer still
 * has to expire on its own clock and 5.5 still has to release the lock. An
 * unconditional write here would hand a student's live offer to a teacher row that
 * claims to be available, which is the double-book this epic exists to prevent.
 *
 * `updateMany` for the count, because the caller emits `teacher:status` only when
 * something actually moved — announcing `OFFLINE` for a teacher who was already
 * offline is a frame every connected client has to process for no change.
 *
 * **`last_seen_at` is deliberately untouched.** Going offline is not activity, and the
 * column has exactly one reader (5.5's sweep). Writing it here would be this path
 * telling the auto-away job that somebody who just left is present.
 *
 * @param {string} teacherId `teacher_profiles.user_id`
 * @returns {Promise<{changed: boolean}>} false when they were not `ONLINE` to begin with
 */
export async function setTeacherOffline(teacherId) {
  const { count } = await prisma.teacherProfile.updateMany({
    where: { userId: teacherId, status: 'ONLINE' },
    data: { status: 'OFFLINE' },
  });

  return { changed: count > 0 };
}

/**
 * The auto-away sweep — PR 5.5's second job, and the one read of `last_seen_at` in
 * this codebase.
 *
 * ```sql
 * UPDATE teacher_profiles SET status = 'OFFLINE'
 *  WHERE status = 'ONLINE' AND last_seen_at IS NOT NULL AND last_seen_at < $1
 * ```
 *
 * **`status = 'ONLINE'` is load-bearing and is not an optimisation.** A teacher who is
 * `OFFER_LOCKED` has an offer out and a stale `last_seen_at` is the expected reading —
 * they are looking at the modal, not clicking. Sweeping them would release a live
 * offer's lock without touching the offer, which is the one way this epic can produce a
 * teacher who is `ONLINE` with a `PENDING` offer against them: E4 then offers them to a
 * second student while the first is still counting down. A teacher who is `IN_SESSION`
 * is teaching. Neither is swept, and the predicate is what says so.
 *
 * **`last_seen_at IS NOT NULL` is the second half of that.** Postgres compares `NULL`
 * to nothing, so the `lt` alone would already skip those rows — the clause is written
 * anyway because it states the product rule: a teacher who has never connected is not
 * idle, they are new, and the day somebody changes the comparison the intent is on the
 * line rather than in a `NULL` semantics footnote.
 *
 * Two statements rather than one, for `expirePendingOffersBefore`'s reason exactly:
 * Prisma's `updateMany` cannot `RETURNING`, and 5.5 emits `teacher:status` per id. The
 * ids are read first and the update is scoped to them, so what comes back is what this
 * call swept. The window between the two can only shrink the set — a teacher who beats
 * in between stops matching `lt` and the update skips them — so no id is reported that
 * this call did not move.
 *
 * Idempotent, because it is conditional: the second tick in the same second finds the
 * rows already `OFFLINE` and updates nothing.
 *
 * **No index, and that was measured rather than assumed.** `teacher_profiles` is 22
 * rows; the `EXPLAIN` is in 5.5's PR description and the plan is a sequential scan
 * costing less than the index lookup would. 4.2's instruction and 4.2's outcome.
 *
 * The instant is passed in, the same rule every other function here follows: deciding
 * what counts as idle is `AUTO_AWAY_MINUTES`'s job, and that number lives in
 * `constants/session.js` where the product can see it.
 *
 * @param {Date} instant teachers last seen before this are away
 * @returns {Promise<string[]>} the ids actually swept, for 5.5 to notify on
 */
export async function sweepIdleTeachers(instant) {
  const idle = await prisma.teacherProfile.findMany({
    where: { status: 'ONLINE', lastSeenAt: { not: null, lt: instant } },
    select: { userId: true },
  });

  if (idle.length === 0) return [];

  const ids = idle.map((teacher) => teacher.userId);

  const { count } = await prisma.teacherProfile.updateMany({
    where: { userId: { in: ids }, status: 'ONLINE', lastSeenAt: { not: null, lt: instant } },
    data: { status: 'OFFLINE' },
  });

  // Equal in every ordinary tick. Fewer means somebody beat, took an offer, or toggled
  // themselves off between the two statements — none of which is an error — and
  // re-reading is how the caller avoids announcing `OFFLINE` for a teacher who is
  // `OFFER_LOCKED` by now.
  if (count !== ids.length) {
    const swept = await prisma.teacherProfile.findMany({
      where: { userId: { in: ids }, status: 'OFFLINE' },
      select: { userId: true },
    });

    return swept.map((teacher) => teacher.userId);
  }

  return ids;
}
