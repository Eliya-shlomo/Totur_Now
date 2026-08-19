import { OFFER_STATUS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import {
  appendRejectedBy,
  findOfferForRespond,
  markOfferResponded,
} from '#repositories/offer.repository.js';
import { releaseTeacherLock, setSessionPending } from '#repositories/session.repository.js';
import { publishTeacherStatus } from '#services/presence.service.js';
import { activateAcceptedOffer } from '#services/session.activate.service.js';
import { emitOfferRejected } from '#sockets/events.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';

/**
 * The teacher's two answers — `POST /offers/:id/accept` and `POST /offers/:id/reject`.
 * PR 5.4, MVP.md §10, §12 and §13.
 *
 * One service for both verbs, because they are the same transaction with a different
 * terminal state and the same assertion in front of them. Splitting them would be two
 * places to forget `expiresAt`.
 *
 * ## What happens when the answer is yes is no longer in this file — 6.3
 *
 * `acceptOffer` still owns everything up to the decision: whose offer it is, whether
 * the instant has passed, and the tidy-up a late answer performs on its way out. The
 * transaction that starts a session, the emit that follows it and the room that follows
 * that are `session.activate.service.js`'s, and this file reaches them through one
 * call.
 *
 * **The split is by concern, not by size.** Answering an offer is this service; what
 * becomes of the *session* when the answer is yes is about to acquire a charge (6.5), a
 * meter (6.5) and an end (6.6), and none of those belongs beside a rejection. The
 * suffix rule since E3, and the reason `git log --oneline -- <file>` still names one PR
 * per change.
 *
 * `blocks_used` and `total_charged` still stay `0` after an accept, and that is still
 * the boundary rather than an oversight — `wallet.service.js` is 6.5's and §17.5 marks
 * it human-written because a bug there creates or destroys real money. **A session that
 * starts and takes no money looks exactly like a billing bug to anyone who has not read
 * this paragraph**, which is why it is here, in `session.activate.service.js`, in the
 * epic README, and in 5.9's retro. The other absence E5 named here — the video room —
 * is filled by 6.3 and its comment is gone.
 *
 * ## Expiry is asserted in code, never read off `status`
 *
 * The sweeper (5.5) runs in-process and Render's free plan spins the instance down
 * after ~15 minutes without a request, so **a cron job on a sleeping instance does
 * not run**: an offer that expired at 14:02 may still read `PENDING` at 14:40. Both
 * paths below compare `expiresAt` against now and believe the instant, not the
 * column. Correctness never depends on a process that is allowed to be asleep — the
 * epic README's gap 6, and the reason the sweep is a *notification* mechanism.
 *
 * A late accept also **tidies up on its way out**: the same transaction marks the
 * offer `EXPIRED`, puts the session back to `PENDING` and releases the teacher, so a
 * teacher who was locked forty minutes ago is not left locked by the very call that
 * discovered it. Then it throws, because the teacher believes they have a session and
 * they do not.
 *
 * ## Why an expired reject is a no-op success and an expired accept is an error
 *
 * Rejecting something that already went away is what the teacher wanted, and
 * answering `409` to it makes a dismissed modal look broken. Accepting it is a
 * different fact about the world: they think they are in a session, so they must be
 * told.
 *
 * ## Every release is conditional, on both paths
 *
 * `releaseTeacherLock`'s `where` carries `status: 'OFFER_LOCKED'`, and that is not
 * optional. A teacher who closed their laptop while the offer was open is already
 * `OFFLINE`; an unconditional write of `ONLINE` puts them back in E4's candidate pool
 * against their wishes, and the next student sends an offer to somebody who is not
 * there. `locked: false` back from it is not an error — it is "they had already moved
 * on" — and **no sequential test notices the difference**, which is the same shape as
 * 5.3's lock and needs the same two browsers.
 *
 * ## Socket emits are after `COMMIT`, never inside the callback
 *
 * Each is a side effect of a transaction that has already succeeded, and every
 * emitter swallows its own transport failure by contract (`sockets/events.js`). A
 * reject that 500s because a socket server hiccuped is a worse product than a reject
 * whose notification was missed. `teacher:status` rides along — E4's first hard filter
 * is `status = 'ONLINE'`, so a teacher who has just been released is a card every open
 * match list is now rendering wrongly. 5.3 announces the lock the same way, through
 * `publishTeacherStatus` rather than the emitter, so that a status change has one shape
 * however it moved. **The accept's two announcements are the same rule, one file
 * across**, below the commit in `session.activate.service.js`.
 *
 * **This service imports `prisma` for `$transaction` and nothing else**, on 5.3's
 * terms and for 5.3's reason: `session.repository.js` is frozen and a
 * `withRespondTransaction` added to it would be a frozen file reopened for a seam
 * that belongs to the service anyway. It arrives through `defaultDeps` as
 * `runTransaction` so the breach is visible rather than buried mid-function. The
 * service decides that answering an offer is atomic; it decides no statement.
 *
 * Every collaborator arrives through the second argument — 3.3's idiom, kept by 5.3 —
 * which is what lets `offer.respond.test.js` assert the calls that *did not* happen
 * with no database at all.
 */
const defaultDeps = {
  findOffer: findOfferForRespond,
  runTransaction: (fn) => prisma.$transaction(fn),
  markResponded: markOfferResponded,
  resetSession: setSessionPending,
  releaseTeacher: releaseTeacherLock,
  appendRejection: appendRejectedBy,
  announceStatus: publishTeacherStatus,
  notifyRejected: emitOfferRejected,
  activate: activateAcceptedOffer,
};

/**
 * `POST /offers/:id/accept` — the teacher taking the question. **Three decisions and a
 * delegation.**
 *
 * ```
 *   pre-flight (one read), and the whole of what this file still owns
 *     1. the offer, or NOT_FOUND — another teacher's is also NOT_FOUND
 *     2. expiresAt <= now  =>  sweep it, release the teacher, then OFFER_EXPIRED
 *     3. activateAcceptedOffer  — the transaction, the emit, and 6.3's room
 * ```
 *
 * Everything from `BEGIN` onwards moved to `session.activate.service.js` in 6.3, along
 * with the `OPENING_BLOCKS × BLOCK_MINUTES` arithmetic that decides `ends_at`. **Neither
 * `2` nor `5` appears anywhere in this file any more, and neither does a status write.**
 *
 * **The `deps` object is passed straight through rather than merged here.** The
 * activation has its own defaults for the collaborators this file no longer names —
 * the locked read, the room, the emit — and merging would mean this service deciding
 * them by omission. One test object can still override both halves, because each side
 * spreads over its own defaults.
 *
 * **The expiry check stays on this side of the call, and stays first.** It is a fact
 * about the *offer*, the activation is about the *session*, and a late accept must be
 * refused before anything takes a row lock. The activation's own `assertTransition` is
 * the second guard rather than a substitute for this one: an offer that died forty
 * minutes ago still sits on a session that reads `OFFER_SENT`, which is a perfectly
 * legal edge.
 *
 * @param {object} input
 * @param {string} input.offerId a uuid, already shape-checked by `offerByIdSchema`
 * @param {string} input.teacherId the caller, from `req.user.id` — never a body's
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{sessionId: string, status: string, startedAt: string, endsAt: string}>}
 */
export async function acceptOffer({ offerId, teacherId }, deps = defaultDeps) {
  const { findOffer, activate } = { ...defaultDeps, ...deps };

  const offer = await loadOwnOffer({ offerId, teacherId, findOffer });

  if (hasExpired(offer)) {
    await sweepExpiredOffer({ offer, teacherId, deps });

    throw new AppError(
      ERROR_CODES.OFFER_EXPIRED,
      'That request has expired. The student has been sent back to their list.',
    );
  }

  // [E6.5] charge the opening block — not here, and not there either. The activation
  //        below leaves `blocks_used` and `total_charged` at `0`; 6.5 charges inside
  //        that same transaction, because a session that goes `ACTIVE` in one statement
  //        and acquires its first block in another is a window where the meter reads
  //        zero on a session that has been paid for.
  const session = await activate({ offer, teacherId }, deps);

  // **Field by field, never a spread.** The activation returns the room's promise on
  // its result so the test can await it; `JSON.stringify` of a promise is `{}`, and a
  // spread here would put that in the response body. The two instants are serialised
  // here and computed there, so the columns and the wire carry one clock.
  return {
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
  };
}

/**
 * `POST /offers/:id/reject` — the teacher declining, and the thing E4 has been
 * waiting for.
 *
 * ```
 *   pre-flight (one read)
 *     1. the offer, or NOT_FOUND
 *     2. expiresAt <= now, or already answered  =>  sweep and answer 200 (a no-op)
 *   BEGIN
 *     3. markOfferResponded REJECTED  -> count 0 => nothing left to do, commit
 *     4. setSessionPending                          (§10's arrow back)
 *     5. appendRejectedBy({questionId, teacherId}, tx)
 *     6. releaseTeacherLock(teacherId, tx)
 *   COMMIT
 *     7. teacher:status ONLINE when released, then offer:rejected to the student
 * ```
 *
 * **`appendRejectedBy` is inside the transaction**, and `offer.repository.js` takes a
 * `tx` for exactly this reason: Prisma has no array-append for a scalar list, so the
 * write is read-append-write, and two rejections landing in the same second lose one
 * entry unless both are serialised by the transaction already holding the offer row.
 *
 * **The session goes back to `PENDING`, not to a new state.** §10's diagram has that
 * arrow and `SessionStatus` has no `REJECTED`; the product's meaning is "this question
 * is unmatched again", which is what `PENDING` already says. The student's screen then
 * re-runs matching and E4's `rejected_by` predicate filters this teacher out — **which
 * has never had a non-empty array to read until this PR.**
 *
 * @param {object} input
 * @param {string} input.offerId
 * @param {string} input.teacherId the caller, from `req.user.id`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{offerId: string, sessionId: string, status: string}>}
 */
export async function rejectOffer({ offerId, teacherId }, deps = defaultDeps) {
  const {
    findOffer,
    runTransaction,
    markResponded,
    resetSession,
    releaseTeacher,
    appendRejection,
    announceStatus,
    notifyRejected,
  } = { ...defaultDeps, ...deps };

  const offer = await loadOwnOffer({ offerId, teacherId, findOffer });
  const sessionId = offer.session.id;

  // An expired reject is a **no-op success**, not a 409. The teacher wanted this offer
  // gone and it is gone; answering an error to a modal they dismissed makes the
  // product look broken. It still sweeps, for the same reason the accept path does —
  // the cron may have been asleep, and a teacher left locked by an offer nobody
  // answered is a teacher E4 will not offer to anybody.
  if (hasExpired(offer)) {
    await sweepExpiredOffer({ offer, teacherId, deps });

    return { offerId, sessionId, status: OFFER_STATUS.EXPIRED };
  }

  const { rejected, released } = await runTransaction(async (tx) => {
    const { count } = await markResponded({ offerId, status: OFFER_STATUS.REJECTED }, tx);

    // Not `PENDING` any more — the sweeper caught it between the read and here, or
    // this is a second click on a modal, or the teacher accepted in another tab.
    // Nothing left to reject, and nothing to undo either: the three writes below all
    // belong to the rejection this transaction did not make. **In particular the
    // session is not reset**, which is what stops a stray reject tearing down a
    // session the same teacher has already accepted.
    if (count === 0) return { rejected: false, released: false };

    await resetSession(sessionId, tx);

    // E4's last hard filter is `teacher_id ∉ question.rejected_by`, and this is its
    // first non-empty array in the product's life. `tx`, never `prisma` — see above.
    await appendRejection({ questionId: offer.session.questionId, teacherId }, tx);

    const { locked } = await releaseTeacher(teacherId, tx);

    return { rejected: true, released: locked };
  });

  // A no-op success answers with the state it found rather than claiming a rejection
  // it did not make, and announces nothing: the student is not told an offer was
  // rejected when it was accepted or swept.
  if (!rejected) {
    return { offerId, sessionId, status: offer.status };
  }

  // Only when the release actually matched. A teacher who went `OFFLINE` while the
  // offer was open is still `OFFLINE`, and announcing `ONLINE` for them would put them
  // back on every open match list — the same defect the `where` clause exists to
  // prevent, one layer up.
  if (released) {
    announceStatus(teacherId, 'ONLINE');
  }

  notifyRejected(offer.session.studentId, { offerId, sessionId });

  return { offerId, sessionId, status: OFFER_STATUS.REJECTED };
}

/**
 * The offer, or `NOT_FOUND` — and the same answer for another teacher's offer.
 *
 * `findOfferForRespond` deliberately does not filter on `teacherId`; the comparison is
 * here, in the service, because a `where` on the teacher would make "somebody else's"
 * and "does not exist" indistinguishable from a typo. `FORBIDDEN` would confirm the id
 * is real, which 3.5, 4.5 and 5.3 all refuse to do, and the uuid being unguessable is
 * not a reason to leak it for free.
 */
async function loadOwnOffer({ offerId, teacherId, findOffer }) {
  const offer = await findOffer(offerId);

  if (!offer || offer.teacherId !== teacherId) {
    throw AppError.notFound('Offer');
  }

  // Every offer in this codebase is created with a session (`createOffer` writes the
  // id), so this is a data problem rather than a state — but the two paths below both
  // walk `offer.session`, and a null here would be a `TypeError` in a transaction
  // instead of an answer.
  if (!offer.session) {
    throw AppError.notFound('Offer');
  }

  return offer;
}

/**
 * `expiresAt <= now()`, **and it does not read `status` to decide.**
 *
 * The column is the sweeper's opinion and the sweeper is allowed to be asleep; the
 * instant is the fact. An offer that still reads `PENDING` forty minutes past its
 * expiry is expired, and this is the only question either path asks about it.
 *
 * `<=` rather than `<`: an offer whose instant is exactly now has had its full
 * `OFFER_TTL_SECONDS` and the boundary belongs to the student, not to the teacher who
 * pressed accept on the same millisecond.
 */
function hasExpired(offer) {
  return offer.expiresAt.getTime() <= Date.now();
}

/**
 * The tidy-up a late answer performs on its way out — **the epic README's gap 6, from
 * the other side.**
 *
 * The cron may not have run, so the caller may be the first thing to notice this offer
 * died. Leaving it as it is would leave a locked teacher out of E4's pool with nothing
 * to unlock them and a session stuck at `OFFER_SENT`, where 5.3's `PENDING` assertion
 * refuses every future **Send request** — the student's question would be
 * unanswerable forever, by a clock rather than by anybody's decision.
 *
 * All three writes are conditional, so this is safe on an offer that was already swept
 * or already accepted: the `updateMany`s match nothing and the function is a no-op.
 * The session reset and the release are **guarded on having swept the offer**, so a
 * late accept on an already-`ACCEPTED` offer cannot reach in and reset a live session.
 *
 * **One divergence from 5.5's sweep, and it is written down rather than hidden.**
 * `markOfferResponded` is the only writer in the frozen `offer.repository.js` that
 * takes a `tx`, so it is the one this transaction can use — and it stamps
 * `responded_at`, where `expirePendingOffersBefore` sets it to `null`. The same offer
 * therefore ends up with a different row depending on which path noticed it died. The
 * instant it writes is truthful about *when the expiry was detected* and nothing
 * renders the column yet, so this is a note rather than a defect: it is in the epic
 * README's gap list, and the reconciliation — either 5.5 stops nulling it, or an
 * `expireOffer(offerId, tx)` joins the repository the next time it is legitimately
 * opened — belongs to whoever opens that file, not to a service reaching around it.
 *
 * Its failures do not become the caller's. The caller is on its way to throwing
 * `OFFER_EXPIRED` (accept) or answering `200` (reject), and neither answer changes if
 * the tidy-up could not run — the sweeper will get it when the instance is next awake.
 */
async function sweepExpiredOffer({ offer, teacherId, deps }) {
  const { runTransaction, markResponded, resetSession, releaseTeacher, announceStatus } = {
    ...defaultDeps,
    ...deps,
  };

  const released = await runTransaction(async (tx) => {
    const { count } = await markResponded({ offerId: offer.id, status: OFFER_STATUS.EXPIRED }, tx);

    if (count === 0) return false;

    await resetSession(offer.session.id, tx);

    const { locked } = await releaseTeacher(teacherId, tx);

    return locked;
  }).catch((error) => {
    logger.warn('Expired offer could not be swept', {
      offerId: offer.id,
      message: error?.message,
    });

    return false;
  });

  if (released) {
    announceStatus(teacherId, 'ONLINE');
  }
}
