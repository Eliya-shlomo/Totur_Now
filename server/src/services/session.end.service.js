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
import { notActiveMessage } from '#utils/sessionMessages.js';
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
 * §11.2's value for a session the platform failed to deliver — 7.4, §5.5 row 2.
 *
 * **The column has had this value since PR 0.2 and nothing has ever written it.** It is
 * in `SessionEndReason` in `shared/api.d.ts` and in the comment above `end_reason` in
 * `sessions.prisma`, and until this PR the only way a session could end was one of the
 * five reasons that charge.
 */
const PLATFORM_ERROR = 'error';

/**
 * What a finished session costs — PR 7.4, MVP.md §5.5.
 *
 * **The whole of §5.5 for a session leaving `ACTIVE`, in one function, on purpose.** Three
 * branches decided in one place and returned as one object, rather than three `if`s spread
 * through a transaction: the *ordering* between them is a decision, and a decision spread
 * over forty lines is a decision the next reader re-makes.
 *
 * §5.5 has six rows. 6.6 implemented four of them — the teacher no-show, the student who
 * leaves after a minute, the student who did not like the answer, and the offer nobody
 * accepted. These are the other two, and they are the two that give money back:
 *
 * ```
 *   1. no room was ever minted            →  full refund, end_reason 'error'
 *   2. the student left inside the window →  full refund, reason unchanged
 *   3. otherwise                          →  6.6's split, unchanged
 * ```
 *
 * **This is a pricing rule and not a lifecycle one, so §10's table is untouched.**
 * `session.state.js` gives `ACTIVE` exactly two edges and neither is added to here. A
 * third terminal state meaning "the same ending, refunded" would be a table every future
 * reader has to reconcile with a diagram that does not contain it — and the session's own
 * money columns already say what happened.
 *
 * ## Case 1 — the platform never provided the lesson
 *
 * `hasVideo` is false: the session reached `ACTIVE`, ran, and `sessions.video_room_url` is
 * still null, so the student paid for a video lesson that was never delivered. That is
 * §5.5's "platform technical failure" in the only form this product can actually detect,
 * and it is not hypothetical — **between PR 6.1 and 6b.1 every session on the deployed
 * application was exactly this**, because `render.yaml` never declared `DAILY_API_KEY`.
 * Every one of them charged in full.
 *
 * It applies **whoever ends the session** — the student, the teacher, or the sweep. A
 * platform failure is not the participants' to bear, and which of them gave up first is
 * not a fact about whose fault it was. That is also why it is checked before case 2: a
 * student who walks out at forty seconds *because there is no camera* is owed the refund
 * for the platform's reason, and `end_reason` should say so rather than say they left.
 *
 * ## Case 2 — the student left inside the window
 *
 * §5.5: "Student closes within 60s of start — full refund". `NO_SHOW_WINDOW_SEC` is the
 * same sixty seconds the teacher's no-show path uses, and until this PR that path was its
 * only reader.
 *
 * **`endReason` is unchanged, and stays `student_ended`.** The column says *why the
 * session is over*; 6.6 already refused to invent a `teacher_ended` value for the same
 * reason. The refund is a fact about the money, and the money is on the session's own
 * columns.
 *
 * **Actor-scoped, deliberately.** Only the student's own end button reaches this. The
 * sweep cannot — the opening block is ten minutes and the window is sixty seconds — and a
 * *teacher* ending at forty seconds is a teacher who walked out, which is nearer to
 * §5.5's no-show row than to this one. Making it actor-blind would let the one party who
 * benefits from a refund trigger it.
 *
 * Strictly inside, so a session ending at exactly `NO_SHOW_WINDOW_SEC` is charged — the
 * same boundary `reportSessionNoShow` draws, and drawing it differently here would mean
 * two sixty-second windows that disagree about the sixtieth second.
 *
 * **And a session somebody extended was not an early exit, whatever the clock says.**
 * `reportSessionNoShow`'s second guard, word for word, because it is the same argument:
 * buying another block is an affirmative act saying the session is working, and a student
 * who pressed **Keep going** and then **End** eight seconds later has told the server two
 * different things. The clock alone would refund them both blocks. `blocks_used` is
 * still the opening block is the check, and it is what makes the window a rule about a
 * session that never got going rather than a rule about the first minute.
 *
 * ## Both refunds are the whole charge, and the fee is zero rather than unset
 *
 * A refund net of commission is the platform keeping money for a lesson it is admitting
 * did not happen. `reportSessionNoShow` writes both columns as explicit zeroes for exactly
 * this reason, and invariant 3 of `scripts/reconcile.mjs` — `platform_fee +
 * teacher_earning === total_charged` on a finished session — is what would catch a
 * refunded session that quietly kept a fee.
 *
 * @param {object} locked the row `findSessionForMeter` returned, under its lock
 * @param {object} context
 * @param {string} context.endReason what the caller asked for
 * @param {string|null} context.actorId who pressed it; `null` is the clock
 * @param {Date} context.endedAt
 * @returns {{platformFee: number, teacherEarning: number, refund: number, endReason: string}}
 */
function settleSession(locked, { endReason, actorId, endedAt }) {
  const gross = locked.totalCharged;

  // Case 1. Before case 2, so a student who walked out because there was no camera is
  // refunded for the platform's reason rather than for their own.
  if (!locked.hasVideo) {
    return { platformFee: 0, teacherEarning: 0, refund: gross, endReason: PLATFORM_ERROR };
  }

  // Case 2. The student's own button, inside the window, measured from `started_at`.
  const startedAt = locked.startedAt?.getTime() ?? 0;
  const elapsedMs = endedAt.getTime() - startedAt;
  const leftEarly = actorId !== null && actorId === locked.studentId;

  const openingBlockOnly = locked.blocksUsed === OPENING_BLOCKS;

  if (leftEarly && openingBlockOnly && elapsedMs < NO_SHOW_WINDOW_SEC * 1000) {
    return { platformFee: 0, teacherEarning: 0, refund: gross, endReason };
  }

  // Case 3 — 6.6's arithmetic, moved here and otherwise unchanged.
  const feeRate = platformFeeRate({
    teacherCreatedAt: locked.teacherCreatedAt,
    // **Not `endedAt`.** The rate the teacher was quoted when the session began.
    at: locked.startedAt ?? endedAt,
  });

  // Rounded once, and the earning is the remainder rather than a second rounding — so
  // `platform_fee + teacher_earning === total_charged` to the credit, which is an
  // acceptance criterion and is what reconciliation reads.
  const platformFee = Math.round(gross * feeRate);

  return { platformFee, teacherEarning: gross - platformFee, refund: 0, endReason };
}

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
  const {
    runTransaction,
    lockSession,
    closeSession,
    creditEarning,
    refundStudent,
    releaseTeacher,
  } = collaborators;

  const endedAt = new Date();

  // Written by the transaction and read after it: §5.5 may overrule what the caller asked
  // for, and the emit and the return value must say what actually happened rather than
  // what was requested. `student_ended` on the wire for a session the platform failed to
  // deliver would be the product blaming the student for its own outage.
  let settledReason = endReason;

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

    // **The specific sentence first, then the table.** 6.8: a person pressing **End** on
    // a screen that was true a second ago is the common case, and `assertTransition`'s one
    // message for every illegal pair cannot tell them whether the session finished or was
    // refunded. The table still refuses everything below — it is the authority on which
    // edges exist and this check adds none.
    refuseTerminal(locked.status);

    // Against the value the lock just read. An already-`ENDED` session refuses above; this
    // refuses every other pair §10 does not draw.
    assertTransition(locked.status, 'ENDED');

    // §5.5, all three branches, decided once against the locked row — 7.4.
    const {
      platformFee,
      teacherEarning,
      refund,
      endReason: reason,
    } = settleSession(locked, {
      endReason,
      actorId,
      endedAt,
    });

    settledReason = reason;

    const { count } = await closeSession(
      {
        sessionId,
        status: 'ENDED',
        endReason: reason,
        endedAt,
        platformFee,
        teacherEarning,
      },
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

    // 7.4 — §5.5's two refunds, and they are mutually exclusive with the credit above:
    // `settleSession` returns a refund only in the branches where the earning is zero.
    // The guard is the same one the earning has, for the same reason — `wallet.service.js`
    // refuses a non-positive amount, and a session that charged nothing has nothing to
    // give back.
    //
    // **After the close, like the credit.** `closeSession`'s `where` carries
    // `status = 'ACTIVE'`, and winning that guard before moving money is what stops the
    // student's button and the sweep both refunding the same session — 6.6's ordering
    // argument, and it holds in this direction too.
    if (refund > 0) {
      await refundStudent(
        {
          userId: locked.studentId,
          sessionId,
          amount: refund,
          note:
            reason === PLATFORM_ERROR
              ? 'Refund: no video was provided'
              : 'Refund: ended within the opening window',
        },
        tx,
      );
    }

    // The counter is unconditional inside the repository; the status change is not. A
    // teacher who closed their laptop mid-session stays `OFFLINE` and still taught a
    // lesson.
    await releaseTeacher({ teacherId: locked.teacherId, sessionsCount: 1 }, tx);
  });

  announceEnd({ sessionId, endReason: settledReason, endedAt, actorId, collaborators });

  return { sessionId, status: 'ENDED', endReason: settledReason, endedAt: endedAt.toISOString() };
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

    refuseTerminal(locked.status);
    assertTransition(locked.status, 'NO_SHOW');

    const startedAt = locked.startedAt?.getTime() ?? 0;

    if (endedAt.getTime() - startedAt > NO_SHOW_WINDOW_SEC * 1000) {
      // The remedy after the window is the end button, which charges. Saying so is the
      // difference between a dead end and a next step — 6.8.
      throw new AppError(
        ERROR_CODES.SESSION_NOT_ACTIVE,
        'The no-show window has closed — you can end the session instead.',
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
 * Refuses a session that has already reached a terminal state, **with the sentence that
 * says which one.** 6.8.
 *
 * It runs before `assertTransition` at every call site and refuses a strict subset of what
 * that table refuses: `ENDED`, `RATED` and `NO_SHOW` have no outgoing edge to `ENDED` or
 * `NO_SHOW` either. So this adds no rule — it adds words. §10's table stays the authority
 * on which transitions exist and 6.2's file is untouched.
 */
function refuseTerminal(status) {
  if (status === 'ENDED' || status === 'RATED' || status === 'NO_SHOW') {
    throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, notActiveMessage(status));
  }
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
