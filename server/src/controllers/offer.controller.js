import { AppError } from '#utils/AppError.js';

/**
 * The teacher's two answers to an offer.
 *
 * **Both handlers are stubs, filled in by 5.4, which owns this file.** Created here
 * for the reason `session.controller.js` is: the router beside it is frozen after
 * this PR, and a controller created later is a controller the router had to be
 * edited to reach.
 *
 * Both call `offer.respond.service.js` — one service for both verbs, because they
 * are the same transaction with a different terminal state and the expiry check in
 * front of them is identical. Not one `session.service.js`; the suffix rule holds.
 */

/**
 * `POST /offers/:id/accept` — the teacher taking the question.
 *
 * §12 writes this as "Creates Zoom, charges 2 blocks, `ACTIVE`". **E5 does neither of
 * the first two.** Zoom is E6 and `wallet.service.js` is E7, which §17.5 marks
 * human-written because a bug there creates or destroys real money. 5.4's transaction
 * is exactly four steps and names the two absences in the file rather than leaving
 * them to be inferred:
 *
 *   1. lock the offer row; assert `PENDING` and not past `expires_at`
 *   2. offer   → `ACCEPTED`, `responded_at = now()`
 *   3. session → `ACTIVE`, `teacher_id`, `price_per_block` snapshot, `started_at`,
 *                `ends_at` from `OPENING_BLOCKS × BLOCK_MINUTES`
 *   4. teacher → `IN_SESSION`, `offers_accepted += 1`
 *
 * **`ACTIVE` here means "the offer was accepted", not "the meter is running."**
 * Nothing is charged, `blocks_used` stays 0 and `total_charged` stays 0. `ends_at` is
 * set anyway so that E6 has a real value to extend rather than a null to special-case.
 * A session that starts and takes no money looks exactly like a billing bug to
 * anyone who has not read this paragraph, which is why it is in the file and in 5.9's
 * retro both.
 *
 * **Expiry is asserted here, not assumed.** The cron (5.5) runs in-process and
 * Render's free plan sleeps the instance, so an offer that expired at 14:02 may still
 * read `PENDING` at 14:40 because nothing was awake to sweep it. Every read of an
 * offer treats `expires_at < now()` as `EXPIRED` whatever the column says, and this
 * transaction re-checks it under the row lock. Correctness must not depend on a
 * process that is allowed to be asleep.
 */
export async function acceptOffer() {
  throw AppError.notImplemented('POST /offers/:id/accept');
}

/**
 * `POST /offers/:id/reject` — the teacher declining.
 *
 * Three writes in one transaction, and each has a way of going quietly wrong:
 *
 *   1. offer → `REJECTED`, `responded_at = now()`, conditional on it still being
 *      `PENDING` — the same `count` check the lock uses
 *   2. `releaseTeacherLock` — a conditional update **from `OFFER_LOCKED`**, never a
 *      bare write of `ONLINE`. A teacher who went offline while the offer was open
 *      must stay offline, and an unconditional release logs them back in
 *   3. `appendRejectedBy({ questionId, teacherId }, tx)` so E4 stops offering this
 *      teacher for this question. Read-append-write inside *this* transaction:
 *      Prisma has no array-append for a scalar list, so two rejections in the same
 *      second lose one entry unless both are holding the offer row
 *
 * The session goes back to `PENDING`, not to a dead end — the student's screen
 * returns to E4's list, which is what "show me more teachers" is for.
 */
export async function rejectOffer() {
  throw AppError.notImplemented('POST /offers/:id/reject');
}
