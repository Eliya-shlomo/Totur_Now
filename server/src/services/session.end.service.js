import { NO_SHOW_WINDOW_SEC, OPENING_BLOCKS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import {
  endSession,
  findSessionForMeter,
  releaseTeacherAfterSession,
} from '#repositories/session.repository.js';
import { assertTransition } from '#services/session.state.js';
import { creditTeacher, refundSession } from '#services/wallet.service.js';
import { emitSessionEnded } from '#sockets/events.js';
import { AppError } from '#utils/AppError.js';
import { platformFeeRate } from '#utils/commission.js';
import { logger } from '#utils/logger.js';

/**
 * How a session stops — PR 6.6, MVP.md §10's two terminal edges out of `ACTIVE`, §5.3's
 * split, and §11.3-B's third money movement.
 *
 * **There is one path out of `ACTIVE` and this file is it.** 6.5's auto-end cron shipped
 * with a direct `endSession` call and is rewired here to come through `terminateSession`
 * instead — named in 6.6's brief so it is not read as scope creep. Two writers of a
 * terminal state is two arithmetics, and the one that runs less often is the one that is
 * wrong.
 *
 * ## The transaction, and why the money is last
 *
 * ```
 *   BEGIN
 *     1. findSessionForMeter(sessionId, tx)      SELECT … FOR UPDATE OF s
 *     2. the caller is a participant             else NOT_FOUND
 *     3. assertTransition(status, 'ENDED')       else SESSION_NOT_ACTIVE
 *     4. fee/earning from total_charged at started_at
 *     5. session → ENDED + ended_at + reason + the two money columns
 *                                                count 0 => SESSION_NOT_ACTIVE
 *     6. creditTeacher(earning)
 *     7. teacher → ONLINE (conditional), sessions_count += 1
 *   COMMIT
 *     8. session:ended to the session's room, both sides
 * ```
 *
 * **Step 5 is above step 6 deliberately.** `endSession`'s `where` carries
 * `status = 'ACTIVE'`, and that count is the race guard: the student's end button and the
 * auto-end sweep can fire in the same tick, and exactly one of them may credit a teacher.
 * Winning the guard before moving money means a lost race never had a `TEACHER_EARNING`
 * row to roll back — the rollback would have taken it, but "crediting twice" is the one
 * mistake in this epic that no reconciliation query can repair afterwards, so it is worth
 * one ordering decision.
 *
 * ## `platform_fee` is resolved at `started_at`
 *
 * §5.3's low-demand window is `[6, 14)`, and a session that begins at 13:55 and ends at
 * 14:05 must not become chargeable halfway through. The teacher was quoted a number when
 * they accepted and that is the number that holds. `platformFeeRate` takes `at` for
 * exactly this reason and E5 lost a test run to its `new Date()` default — the defect is
 * invisible except across one hour boundary a day.
 *
 * **§5.3 is imported, never restated.** Two implementations are two answers to "what did I
 * earn", and the teacher was quoted the first one at offer time.
 *
 * ## Either side may end, and both write the same reason
 *
 * §11.2's `end_reason` has no `teacher_ended` value and inventing one is a migration. The
 * column says *why* the session is over; the *actor* rides on the emit and the log. That
 * is why the route carries `authenticate` and no `authorize` — an authorisation rule about
 * a row rather than a role, which 5.4 and 6.4 both made before this.
 */
const defaultDeps = {
  runTransaction: (fn) => prisma.$transaction(fn),
  lockSession: findSessionForMeter,
  closeSession: endSession,
  creditEarning: creditTeacher,
  refundStudent: refundSession,
  releaseTeacher: releaseTeacherAfterSession,
  notifyEnded: emitSessionEnded,
};

/** §11.2's value for a teacher who never arrived. The refund path's reason. */
const TEACHER_NO_SHOW = 'teacher_no_show';

/**
 * Ends a session and pays the teacher.
 *
 * **`actorId` is `null` for the clock.** The auto-end sweep passes none, and that is what
 * skips the participation check in step 2 — nobody pressed anything, so there is nobody to
 * be a participant. It is also what the emit carries, so 6.7 can say *the session ended*
 * rather than *they ended it*.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.endReason one of §11.2's values — `student_ended` from the button
 * @param {string|null} [input.actorId] whoever pressed it, from `req.user.id`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{sessionId: string, status: 'ENDED', endReason: string, endedAt: string}>}
 */
export async function terminateSession(
  { sessionId, endReason, actorId = null },
  deps = defaultDeps,
) {
  const collaborators = { ...defaultDeps, ...deps };
  const { runTransaction, lockSession, closeSession, creditEarning, releaseTeacher } =
    collaborators;

  const endedAt = new Date();

  await runTransaction(async (tx) => {
    const locked = await lockSession(sessionId, tx);

    if (!locked) {
      throw AppError.notFound('Session');
    }

    // A stranger gets what a missing session gets. The sweep passes no actor and is not
    // checked against anything — it is the clock, not a person.
    if (actorId && locked.studentId !== actorId && locked.teacherId !== actorId) {
      throw AppError.notFound('Session');
    }

    // Against the value the lock just read. An already-`ENDED` session refuses here, which
    // is the double-click and the second sweep.
    assertTransition(locked.status, 'ENDED');

    const gross = locked.totalCharged;
    const feeRate = platformFeeRate({
      teacherCreatedAt: locked.teacherCreatedAt,
      // **Not `endedAt`.** The rate the teacher was quoted when the session began.
      at: locked.startedAt ?? endedAt,
    });

    // Rounded once, and the earning is the remainder rather than a second rounding — so
    // `platform_fee + teacher_earning === total_charged` to the credit, which is an
    // acceptance criterion and is what reconciliation reads.
    const platformFee = Math.round(gross * feeRate);
    const teacherEarning = gross - platformFee;

    const { count } = await closeSession(
      { sessionId, status: 'ENDED', endReason, endedAt, platformFee, teacherEarning },
      tx,
    );

    // Somebody else won: the other participant's button, or the sweep. Their transaction
    // is crediting the teacher and this one must not.
    if (count === 0) {
      throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, 'This session is no longer running.');
    }

    // Once, at the end, net of the fee — never per block. A session refunded as a no-show
    // would otherwise have to claw back credit the teacher already held, and clawing back
    // is the one operation an append-only ledger cannot express honestly.
    //
    // A zero earning writes no row rather than a zero-credit one: `wallet.service.js`
    // refuses a non-positive amount as a programming error, and a session that charged
    // nothing is one that ended before 6.5's charge could run.
    if (teacherEarning > 0) {
      await creditEarning(
        { userId: locked.teacherId, sessionId, amount: teacherEarning, note: 'Session earning' },
        tx,
      );
    }

    // The counter is unconditional inside the repository; the status change is not. A
    // teacher who closed their laptop mid-session stays `OFFLINE` and still taught a
    // lesson.
    await releaseTeacher({ teacherId: locked.teacherId, sessionsCount: 1 }, tx);
  });

  announceEnd({ sessionId, endReason, endedAt, actorId, collaborators });

  return { sessionId, status: 'ENDED', endReason, endedAt: endedAt.toISOString() };
}

/**
 * The teacher never arrived — a full refund, and no earning at all.
 *
 * ```
 *   BEGIN
 *     1. lock; the caller is this session's student   else NOT_FOUND
 *     2. assertTransition(status, 'NO_SHOW')
 *     3. within NO_SHOW_WINDOW_SEC of started_at      else SESSION_NOT_ACTIVE
 *     4. blocks_used is still the opening block       else SESSION_NOT_ACTIVE
 *     5. session → NO_SHOW, teacher_no_show, fee 0, earning 0
 *     6. refundSession(total_charged)                 ← the whole of it
 *     7. teacher → ONLINE (conditional), no_show_count += 1
 *   COMMIT
 * ```
 *
 * **The refund is the full `total_charged` and no fee is taken from it.** A refund net of
 * commission is the platform keeping money for a lesson that did not happen.
 *
 * **`sessions_count` does not move.** `no_show_count` does. E4's Bayesian smoothing
 * divides one aggregate by another and a lesson nobody taught belongs in neither
 * numerator nor denominator.
 *
 * **Two guards beyond the state machine, and `NO_SHOW_WINDOW_SEC` gets its first reader
 * here.** After a minute the student's remedy is the end button, which charges — that is
 * the product's answer, and it is why the window is short and enforced on the server. The
 * second guard is `blocks_used`: a session that was extended was not a no-show, whatever
 * the clock says.
 *
 * **`NO_SHOW` is terminal and is never rated.** §10 draws no arrow out of it: a review
 * about somebody who never arrived is a row about nothing, and it would take
 * `resolved_count` down with it.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.studentId the caller, from `req.user.id`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{sessionId: string, status: 'NO_SHOW', endReason: string,
 *   endedAt: string, balance: number|null}>}
 */
export async function reportSessionNoShow({ sessionId, studentId }, deps = defaultDeps) {
  const collaborators = { ...defaultDeps, ...deps };
  const { runTransaction, lockSession, closeSession, refundStudent, releaseTeacher } =
    collaborators;

  const endedAt = new Date();

  const balance = await runTransaction(async (tx) => {
    const locked = await lockSession(sessionId, tx);

    if (!locked || locked.studentId !== studentId) {
      throw AppError.notFound('Session');
    }

    assertTransition(locked.status, 'NO_SHOW');

    const startedAt = locked.startedAt?.getTime() ?? 0;

    if (endedAt.getTime() - startedAt > NO_SHOW_WINDOW_SEC * 1000) {
      throw new AppError(
        ERROR_CODES.SESSION_NOT_ACTIVE,
        'It is too late to report a no-show for this session.',
      );
    }

    // A session somebody extended was not a no-show. The window above makes this nearly
    // unreachable; it is here because "nearly" is not a guarantee and this one is free.
    if (locked.blocksUsed !== OPENING_BLOCKS) {
      throw new AppError(
        ERROR_CODES.SESSION_NOT_ACTIVE,
        'This session has already run past its first block.',
      );
    }

    const { count } = await closeSession(
      {
        sessionId,
        status: 'NO_SHOW',
        endReason: TEACHER_NO_SHOW,
        endedAt,
        // Both zero, explicitly. §5.3's split never ran on this session and a fee on a
        // refunded lesson is the platform charging for nothing.
        platformFee: 0,
        teacherEarning: 0,
      },
      tx,
    );

    if (count === 0) {
      throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, 'This session is no longer running.');
    }

    let balanceAfter = null;

    if (locked.totalCharged > 0) {
      ({ balanceAfter } = await refundStudent(
        { userId: studentId, sessionId, amount: locked.totalCharged, note: 'No-show refund' },
        tx,
      ));
    }

    // `sessions_count` deliberately absent. Nobody taught anything.
    await releaseTeacher({ teacherId: locked.teacherId, noShowCount: 1 }, tx);

    return balanceAfter;
  });

  announceEnd({
    sessionId,
    endReason: TEACHER_NO_SHOW,
    endedAt,
    actorId: studentId,
    collaborators,
  });

  return {
    sessionId,
    status: 'NO_SHOW',
    endReason: TEACHER_NO_SHOW,
    endedAt: endedAt.toISOString(),
    balance,
  };
}

/**
 * `session:ended`, **after the commit and never inside it.**
 *
 * The one event in this epic where reaching both sides is not a convenience: whichever
 * participant did not press the button has no HTTP response coming, and would otherwise
 * sit on a screen counting down a session that has been billed and closed.
 *
 * Logged as well as emitted, because the emit is the only record of *who* — `end_reason`
 * deliberately does not carry the actor, and an operator asking "who ended this" has
 * nothing else to read.
 */
function announceEnd({ sessionId, endReason, endedAt, actorId, collaborators }) {
  logger.info('Session ended', { sessionId, endReason, actorId });

  collaborators.notifyEnded(sessionId, {
    endReason,
    endedAt: endedAt.toISOString(),
    actorId,
  });
}
