import { prisma } from '#config/db.js';
import { findOfferForRespond, expirePendingOffersBefore } from '#repositories/offer.repository.js';
import { releaseTeacherLock, setSessionPending } from '#repositories/session.repository.js';
import { emitOfferExpired, emitOfferRejected, emitTeacherStatus } from '#sockets/events.js';
import { logger } from '#utils/logger.js';

/**
 * Offer expiry — the first of §13's four background jobs, on the `CRON_TICK_SECONDS`
 * tick. PR 5.5, MVP.md §10, §12, §13.
 *
 * An offer nobody answered inside `OFFER_TTL_SECONDS` becomes `EXPIRED`, its teacher
 * goes back to `ONLINE`, and its session goes back to `PENDING` — exactly the row
 * state a reject leaves behind, with one difference that has its own paragraph below.
 *
 * ## The teacher is NOT appended to `rejected_by`, and this is the paragraph to read
 * before changing anything here
 *
 * §12 puts `rejected_by` on the reject endpoint and only there. A teacher who never
 * saw the modal has not rejected anything, and E4's last hard filter is
 * `teacher_id ∉ question.rejected_by` — so appending here would permanently exclude a
 * teacher from that student's pool for this question because they were away from the
 * keyboard for sixty seconds. That is a punishment for being busy, it is invisible
 * (the teacher simply stops appearing, with no error anywhere), and it is
 * irreversible: nothing in this codebase removes an id from that column.
 *
 * `appendRejectedBy` is deliberately not imported below. **It is the single most
 * likely well-meant improvement anybody makes to this file** — the student is sent
 * `offer:rejected` and the symmetry is inviting — so the absence is written down
 * rather than left to be noticed in review.
 *
 * ## Why the student's event is `offer:rejected` and not only `offer:expired`
 *
 * Both are sent, to different people, and `sockets/events.js` says so in
 * `emitOfferExpired`'s header. The teacher gets `offer:expired`: their modal has to
 * close, and the reason it closed is the clock. The student gets `offer:rejected`:
 * their screen has to go back to E4's list, which is the same recovery a decline
 * produces, and 5.8 has one handler for "this offer is over, pick somebody else"
 * rather than two that must not drift.
 *
 * ## The sweep is a notification mechanism. It is not the source of truth
 *
 * Render's free plan spins the instance down after ~15 minutes without a request and
 * `node-cron` runs in-process, so **this job does not run on a sleeping server**: an
 * offer that expired at 14:02 may still read `PENDING` at 14:40. 5.4 already evaluates
 * `expires_at` on every read and sweeps the row it finds, which is what makes the
 * product correct. This job is what makes it *timely* — the teacher's modal closes
 * itself and the student's countdown resolves while somebody is watching. Correctness
 * on the read, timeliness on the tick, and neither is sufficient alone.
 *
 * ## One divergence from 5.4's path, recorded rather than reconciled
 *
 * `expirePendingOffersBefore` sets `responded_at` to `null`; 5.4's late-answer sweep
 * goes through `markOfferResponded`, which stamps it. The same expired offer therefore
 * ends up with a different row depending on which path noticed it died. Reconciling
 * means opening `offer.repository.js`, which is frozen and on this PR's denylist, and
 * nothing renders the column yet. It is the epic README's gap and it stays there.
 *
 * Every collaborator arrives through the second argument — 5.3's and 5.4's idiom —
 * which is what lets `jobs.test.js` call this function with no database and assert the
 * calls that did **not** happen.
 */
const defaultDeps = {
  expireOffers: expirePendingOffersBefore,
  findOffer: findOfferForRespond,
  runTransaction: (fn) => prisma.$transaction(fn),
  resetSession: setSessionPending,
  releaseTeacher: releaseTeacherLock,
  notifyExpired: emitOfferExpired,
  notifyRejected: emitOfferRejected,
  announceStatus: emitTeacherStatus,
};

/**
 * One tick's worth of expiry. Called by the scheduler, and directly by the tests.
 *
 * ```
 *   1. expirePendingOffersBefore(now)   -> ids, or [] and we are done silently
 *   for each id:
 *     2. findOfferForRespond(id)        -> teacher, session, student
 *     BEGIN
 *       3. setSessionPending            (§10's arrow back — conditional)
 *       4. releaseTeacherLock           (conditional — see below)
 *     COMMIT
 *     5. offer:expired to the teacher, offer:rejected to the student
 *     6. teacher:status ONLINE, only when the release actually matched
 * ```
 *
 * **The `updateMany` in step 1 is what makes the whole job idempotent.** The status
 * change is conditional on the row still being `PENDING`, so a tick that overlaps the
 * previous one finds nothing left to expire and the second pass emits nothing. Two
 * ticks in the same second leave the same end state as one, and a second instance
 * would be harmless. There is one instance today; this is written down so the property
 * is not lost during a scale-up.
 *
 * **Step 6 is guarded on `locked`, for `offer.respond.service.js`'s reason.** A teacher
 * who closed their laptop while the offer was open is already `OFFLINE`, and
 * `releaseTeacherLock`'s `where` refuses to move them — announcing `ONLINE` for them
 * anyway would put them back on every open match list, which is the defect the
 * predicate exists to prevent, one layer up.
 *
 * **`emitTeacherStatus` directly, not `publishTeacherStatus`.** The service wrapper
 * also calls `recordTeacherActivity(force)`, which writes `last_seen_at = now`. Every
 * other caller has a real reason to — somebody just did something — and this one does
 * not: the teacher whose offer just expired did nothing at all, and stamping the
 * column here would be this job telling the auto-away job a teacher is present. The
 * two jobs share one column and must not write each other's inputs.
 *
 * **Per-offer reads and per-offer transactions, deliberately.** An ordinary tick
 * expires nought or one offer; the pathological one after an instance wakes up expires
 * a handful. A batched transaction would make one slow offer's failure roll back the
 * others' releases, and a teacher left locked is the failure this job exists to
 * prevent. Each offer is independent and each one's failure is logged and stepped over.
 *
 * Never throws. The scheduler has no request to fail and a job that rejects on a bad
 * tick would take the next tick with it.
 *
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{expired: number}>} how many offers this tick actually swept
 */
export async function runOfferExpiry(deps = defaultDeps) {
  const {
    expireOffers,
    findOffer,
    runTransaction,
    resetSession,
    releaseTeacher,
    notifyExpired,
    notifyRejected,
    announceStatus,
  } = { ...defaultDeps, ...deps };

  let offerIds;

  try {
    offerIds = await expireOffers(new Date());
  } catch (error) {
    // The sweep itself is the only statement here outside `settleExpiredOffer`'s own
    // guard, and a database that is down fails it on every tick. Logged once per tick
    // and returned from: the next tick expires whatever this one could not.
    logger.error('Offer expiry sweep failed', { message: error?.message, stack: error?.stack });

    return { expired: 0 };
  }

  // **The empty tick is silent, and that is an acceptance criterion.** At ten seconds
  // a tick, "expired 0 offers" is 8,640 lines a day, which is how a log stops being
  // read — and the lines that matter in this epic are the ones nobody is looking for.
  if (offerIds.length === 0) return { expired: 0 };

  for (const offerId of offerIds) {
    await settleExpiredOffer(offerId, {
      findOffer,
      runTransaction,
      resetSession,
      releaseTeacher,
      notifyExpired,
      notifyRejected,
      announceStatus,
    });
  }

  logger.info('Offer expiry swept offers', { count: offerIds.length });

  return { expired: offerIds.length };
}

/**
 * One offer's aftermath: the session back to `PENDING`, the teacher released, and
 * three events.
 *
 * The read happens after the status write rather than before it, which is safe because
 * `findOfferForRespond` filters on nothing but the id — the row it returns is the one
 * that was just marked `EXPIRED`, and its `teacher_id`, `session_id` and `student_id`
 * are immutable for the life of an offer.
 *
 * **The whole thing is wrapped**, because a job is not a request: an offer whose
 * session row vanished under it must not stop the other offers in the same tick from
 * being settled, and must not reject into the scheduler.
 */
async function settleExpiredOffer(offerId, deps) {
  const {
    findOffer,
    runTransaction,
    resetSession,
    releaseTeacher,
    notifyExpired,
    notifyRejected,
    announceStatus,
  } = deps;

  try {
    const offer = await findOffer(offerId);

    // The row was read a moment ago by the sweep, so this is a data problem rather
    // than a state. Logged and stepped over: there is nobody to notify and nothing to
    // release without a teacher id.
    if (!offer || !offer.session) {
      logger.warn('Expired offer has no row to settle', { offerId });

      return;
    }

    const { teacherId } = offer;
    const sessionId = offer.session.id;

    const released = await runTransaction(async (tx) => {
      // Conditional on `OFFER_SENT`, so an offer that expired against a session
      // somebody already cancelled leaves that session alone. A zero count is not an
      // error and there is nothing here that reads it.
      await resetSession(sessionId, tx);

      const { locked } = await releaseTeacher(teacherId, tx);

      return locked;
    });

    // Both sides, always, and before the status announcement: the two people watching
    // a countdown are told what happened to their offer first, and the match lists of
    // everybody else are corrected second.
    notifyExpired(teacherId, { offerId, sessionId });
    notifyRejected(offer.session.studentId, { offerId, sessionId });

    if (released) {
      announceStatus(teacherId, { teacherId, status: 'ONLINE' });
    }
  } catch (error) {
    // `error` and not `warn`: this leaves a teacher locked and a session stuck at
    // `OFFER_SENT`, where 5.3's `PENDING` assertion refuses every future **Send
    // request**. 5.4's read path recovers it the next time anybody answers that offer,
    // so it is not unrecoverable — but it is the shape of failure this job exists to
    // prevent and it should be loud.
    logger.error('Expired offer could not be settled', {
      offerId,
      message: error?.message,
      stack: error?.stack,
    });
  }
}
