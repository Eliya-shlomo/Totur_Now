import { BLOCK_MINUTES, OFFER_STATUS, OPENING_BLOCKS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { markOfferResponded } from '#repositories/offer.repository.js';
import {
  findSessionForMeter,
  recordBlock,
  setSessionActive,
  setSessionVideoRoom,
  setTeacherInSession,
} from '#repositories/session.repository.js';
import { publishTeacherStatus } from '#services/presence.service.js';
import { assertTransition } from '#services/session.state.js';
import { createSessionVideo } from '#services/video.service.js';
import { chargeStudent } from '#services/wallet.service.js';
import { emitOfferAccepted } from '#sockets/events.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';

/**
 * `OFFER_SENT` → `ACTIVE`, and the room the two of them are about to be in. PR 6.3,
 * MVP.md §10's one remaining forward edge and §12's `POST /offers/:id/accept`.
 *
 * ## Why this is not `offer.respond.service.js`
 *
 * That service is about *answering* an offer, and it still owns both answers. What
 * happens to the **session** when the answer is yes is a different concern, and it is
 * about to acquire a charge (6.5), a meter (6.5) and an end (6.6). Suffixed by concern,
 * as everything has been since E3, so that `git log --oneline -- <file>` names one PR
 * per change rather than four PRs opening one `session.service.js`.
 *
 * ## The transaction, and the one step that is outside it
 *
 * ```
 *   BEGIN
 *     1. findSessionForMeter(sessionId, tx)          SELECT … FOR UPDATE OF s
 *     2. assertTransition(locked.status, 'ACTIVE')   ← against what the lock just read
 *     3. offer   → ACCEPTED       count 0 => OFFER_EXPIRED, roll back
 *     4. session → ACTIVE, startedAt, endsAt
 *                                 count 0 => SESSION_NOT_ACTIVE, roll back
 *     5. teacher → IN_SESSION     locked false => TEACHER_UNAVAILABLE, roll back
 *     6. chargeStudent(OPENING_BLOCKS × price)   => INSUFFICIENT_CREDIT, roll back
 *     7. recordBlock(#1, OPENING_BLOCKS × BLOCK_MINUTES)
 *   COMMIT
 *     8. teacher:status IN_SESSION, then offer:accepted to the student
 *     9. createSessionVideo → setSessionVideoRoom    ← never awaited
 * ```
 *
 * **Step 7 is outside the transaction, and that is the single most important line in
 * this file.** `createSessionVideo` is a `fetch` across the public internet. Inside the
 * transaction it holds a row lock on the session *and* the teacher for as long as Daily
 * takes to answer, which on a bad day is thirty seconds — during which the teacher
 * cannot be released, no other offer can be evaluated against them, and the connection
 * pool is one smaller. Nothing about the room needs to be atomic with the state change:
 * a room with no session is litter that expires in 24 hours, and a session with no room
 * is the degraded case this file is explicitly designed to survive.
 *
 * **A failed room creation does not fail the accept.** It is caught, logged at `error`
 * with the session id, and the accept still answers `200`. The columns stay null,
 * `hasVideo` is `false`, and the session runs. Same ruling E5 made for the offer email
 * — *an offer that 500s because an email provider is down is a worse product than an
 * offer with no email* — and it is why 6.1 turned the missing-key `Error` into an
 * `AppError` this path can recognise. The repair is 6.4's: the first
 * `GET /sessions/:id/video` against null columns mints the room then, so a Daily outage
 * at accept time costs nothing permanent as long as it has ended by the time somebody
 * presses join.
 *
 * ## The opening block, and why it is inside the transaction — 6.5
 *
 * §5.1 sells the first ten minutes up front, so `OPENING_BLOCKS × price_per_block` leaves
 * the student's wallet in the transaction that starts the session. **Not after it.** A
 * session that goes `ACTIVE` and then fails to charge is free tutoring, and a charge that
 * lands against a session that failed to start is theft; one transaction is the only
 * arrangement where neither is reachable.
 *
 * The amount is computed from the **locked** row's `price_per_block` — the snapshot 5.3
 * wrote at offer time, so a teacher who changed tier while the modal was open cannot
 * reprice a block the student was quoted.
 *
 * **`INSUFFICIENT_CREDIT` rolls the accept back rather than starting a free session.**
 * E5 checks affordability at offer time as a read and the balance is allowed to have
 * moved since; this is the write, and it is the one that decides. The rollback leaves the
 * offer `PENDING` and the teacher `OFFER_LOCKED` — untouched, because Postgres undoes all
 * four writes together — so the offer lives out its TTL and 5.5's sweep releases the
 * teacher. Nothing here compensates by hand.
 *
 * `recordBlock` writes block 1 in the same transaction, for the same reason
 * `setSessionActive` carries the two counters: `total_charged` and the sum of a session's
 * blocks are reconciled against each other, and a window where they disagree is a window
 * where the answer depends on when you looked.
 *
 * ## Every collaborator arrives through the second argument
 *
 * 3.3's idiom, kept by 5.3 and 5.4. It is what lets `session.activate.test.js` assert
 * the calls that *did not* happen — that no room is created before the commit, that a
 * rolled-back transaction announces nothing — with no database and no API key at all.
 *
 * **This service imports `prisma` for `$transaction` and nothing else**, on 5.3's terms
 * and for 5.3's reason: `session.repository.js` is frozen and a
 * `withActivateTransaction` added to it would be a frozen file reopened for a seam that
 * belongs to the service anyway. It arrives through `defaultDeps` as `runTransaction`
 * so the breach is visible rather than buried mid-function.
 */
const defaultDeps = {
  runTransaction: (fn) => prisma.$transaction(fn),
  lockSession: findSessionForMeter,
  markResponded: markOfferResponded,
  activateSession: setSessionActive,
  takeTeacher: setTeacherInSession,
  announceStatus: publishTeacherStatus,
  notifyAccepted: emitOfferAccepted,
  createRoom: createSessionVideo,
  saveRoom: setSessionVideoRoom,
  chargeCredits: chargeStudent,
  saveBlock: recordBlock,
};

/**
 * The opening block's duration in milliseconds.
 *
 * **Neither `2` nor `5` appears anywhere in this file.** 5.4's line and 4.8's lesson
 * before it: a service or a test that typed the number would go on passing the day
 * somebody tunes the appendix, and would be wrong.
 */
const OPENING_BLOCK_MS = OPENING_BLOCKS * BLOCK_MINUTES * 60 * 1000;

/**
 * Turns an accepted offer into a running session, then goes and gets it a room.
 *
 * **The failure path rolls back; it never compensates.** There is no `catch` here that
 * puts a teacher back by hand — that would be a second lock implementation with worse
 * semantics. Every throw inside the callback aborts the transaction and Postgres undoes
 * all three writes together.
 *
 * `startedAt` and `endsAt` are computed once, before the transaction, so the column and
 * every future reader see one instant rather than two clocks. They are `Date`s on the
 * way out and the caller serialises them; a service that returned strings would make
 * the two writes and the response disagree the day one of them is reformatted.
 *
 * **`video` is a promise and it is on the return value on purpose.** Production ignores
 * it — that is what makes the `200` observable in the log before the room write — and
 * the test awaits it, which is the only way to assert that ordering deterministically.
 * It never rejects: `attachSessionVideo` resolves either way, so an ignored promise is
 * never an unhandled rejection. **It must not reach the HTTP body**, and `acceptOffer`
 * builds its response field by field rather than spreading this object for exactly that
 * reason — `JSON.stringify` of a promise is `{}`.
 *
 * @param {object} input
 * @param {object} input.offer the `findOfferForRespond` row, already proven to be the
 *   caller's and already proven unexpired by `offer.respond.service.js`
 * @param {string} input.teacherId the caller, from `req.user.id`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{sessionId: string, status: string, startedAt: Date, endsAt: Date,
 *   video: Promise<boolean>}>}
 */
export async function activateAcceptedOffer({ offer, teacherId }, deps = defaultDeps) {
  const collaborators = { ...defaultDeps, ...deps };
  const {
    runTransaction,
    lockSession,
    markResponded,
    activateSession,
    takeTeacher,
    chargeCredits,
    saveBlock,
  } = collaborators;

  const sessionId = offer.session.id;
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + OPENING_BLOCK_MS);

  await runTransaction(async (tx) => {
    // Step 1. `SELECT … FOR UPDATE OF s`. Read-then-decide-then-write with a gap in the
    // middle is two accepts both seeing `OFFER_SENT`, both passing the assert below,
    // and both starting a session. The lock closes the gap; the conditional writes
    // after it close the other half.
    const locked = await lockSession(sessionId, tx);

    // The session behind an offer the caller already loaded. Absent means the row went
    // away between the two reads, which is a data problem rather than a state — and it
    // gets the same `NOT_FOUND` a stranger's request gets, because this endpoint must
    // not say which of the two happened.
    if (!locked) {
      throw AppError.notFound('Session');
    }

    // Step 2. **Against the value the lock just read**, never against one fetched
    // earlier in the request. That is the whole guarantee `session.state.js` documents,
    // and reading it off `offer.session.status` — which is right there, one call up in
    // `acceptOffer` — is precisely the defect the lock exists to prevent.
    assertTransition(locked.status, 'ACTIVE');

    const { count } = await markResponded({ offerId: offer.id, status: OFFER_STATUS.ACCEPTED }, tx);

    // Zero means the row was not `PENDING` when this transaction reached it: the
    // sweeper beat it, or the teacher double-clicked and the first click won. Both are
    // `OFFER_EXPIRED` to the caller, and this is what stops a second `ACTIVE` session
    // being created out of an already-`ACCEPTED` offer.
    if (count === 0) {
      throw new AppError(
        ERROR_CODES.OFFER_EXPIRED,
        'That request has expired. The student has been sent back to their list.',
      );
    }

    // **The price is the locked row's, never the offer's and never the request's.** 5.3
    // snapshots `price_per_block` onto the session when the offer goes out, precisely so
    // that a tier change while the modal is open cannot reprice a block the student was
    // quoted. A null here is a session that reached `OFFER_SENT` without one, which is a
    // data problem rather than a free lesson.
    const amount = OPENING_BLOCKS * locked.pricePerBlock;

    if (!Number.isInteger(amount) || amount <= 0) {
      logger.error('Accept found a session with no usable price', {
        sessionId,
        pricePerBlock: locked.pricePerBlock,
      });

      throw AppError.internal();
    }

    // Step 4. `blocksUsed` and `totalCharged` are written with the status — 6.5. The
    // charge two statements down is what pays for them, in this same transaction, so
    // there is no instant at which an `ACTIVE` session reads as unbilled.
    const { count: activated } = await activateSession(
      { sessionId, startedAt, endsAt, blocksUsed: OPENING_BLOCKS, totalCharged: amount },
      tx,
    );

    // The assert above refuses an edge that was never legal; this refuses a row that
    // moved between the lock and the write. Either alone leaves one of the two failures
    // silent — `session.state.js` says so at length, and this is the call site it means.
    if (activated === 0) {
      throw new AppError(
        ERROR_CODES.SESSION_NOT_ACTIVE,
        'This session is no longer waiting for an answer.',
      );
    }

    const { locked: taken } = await takeTeacher(teacherId, tx);

    // `OFFER_LOCKED` → `IN_SESSION`, conditional like every other write to this column.
    // `false` means the teacher was no longer locked — they went `OFFLINE` while the
    // modal was open, or they are already `IN_SESSION` with somebody else — and an
    // unconditional write would put them in two sessions at once and count the
    // acceptance twice. `info` rather than `error`: refusing this is the product
    // working, and it is the one line that would explain the 409 under load.
    if (!taken) {
      logger.info('Accept found the teacher no longer locked', {
        offerId: offer.id,
        teacherId,
        sessionId,
      });

      throw new AppError(
        ERROR_CODES.TEACHER_UNAVAILABLE,
        'You are no longer available for this request.',
      );
    }

    // Step 6. **The money, last, and inside.** `chargeStudent` takes the `tx` and opens
    // nothing of its own: it locks the wallet row, asserts the balance against what that
    // lock returned, moves the balance and appends the ledger row. `INSUFFICIENT_CREDIT`
    // (402) throws out of the callback like every other failure here and Postgres undoes
    // the three writes above with it — no compensation, no half-started session, and no
    // ledger row for a session that never ran.
    //
    // Last because it is the only step that touches a second person's row: a charge that
    // succeeded and then hit `TEACHER_UNAVAILABLE` would be undone by the same rollback,
    // but it would also have held a lock on the student's wallet across the teacher's
    // write for no reason.
    await chargeCredits(
      { userId: offer.session.studentId, sessionId, amount, note: 'Opening block' },
      tx,
    );

    // Step 7. Block 1, in the same transaction as the charge that bought it. `minutes` is
    // `OPENING_BLOCKS × BLOCK_MINUTES` — the constants, never the number, so the day the
    // appendix is tuned this moves with it.
    await saveBlock(
      {
        sessionId,
        blockNumber: 1,
        minutes: OPENING_BLOCKS * BLOCK_MINUTES,
        amount,
      },
      tx,
    );
  });

  collaborators.announceStatus(teacherId, 'IN_SESSION');

  // **Before the room, and after the commit.** The student's screen navigates on
  // `offer:accepted` and then fetches; it must not wait on Daily any more than the
  // teacher's `200` does. No room URL on the wire either — §13's payload is
  // `{offerId, sessionId}` and a token is per-caller, so the URL is 6.4's alone.
  collaborators.notifyAccepted(offer.session.studentId, { offerId: offer.id, sessionId });

  return {
    sessionId,
    status: 'ACTIVE',
    startedAt,
    endsAt,
    video: attachSessionVideo(sessionId, collaborators),
  };
}

/**
 * Step 7 — the room, and **every way it can fail is a log line rather than an error.**
 *
 * Exported for 6.4, which needs the same two statements on its repair path, and for the
 * test, which awaits it.
 *
 * **This function never rejects.** Its caller does not await it — that is what keeps
 * Daily off the accept's critical path — and a rejected promise nobody is holding is an
 * unhandled rejection, which on Node is a process-level event and on Render is a
 * restart. The `try` wraps both statements and the function resolves to a boolean.
 *
 * A `count` of `0` from `setSessionVideoRoom` is not a failure. The write is conditional
 * on `video_room_name IS NULL`, so zero means somebody else minted the room first —
 * 6.4's repair racing this call, or a retry — and the room this call created is litter
 * that expires in 24 hours. `info`, because the session has a room either way and the
 * only thing that happened is that it is not this one.
 *
 * @param {string} sessionId
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<boolean>} whether *this* call is the one that persisted a room
 */
export async function attachSessionVideo(sessionId, deps = defaultDeps) {
  const { createRoom, saveRoom } = { ...defaultDeps, ...deps };

  try {
    const room = await createRoom(sessionId);

    const { count } = await saveRoom({
      sessionId,
      roomName: room.roomName,
      roomUrl: room.roomUrl,
    });

    if (count === 0) {
      logger.info('Session already had a video room; the one just created is discarded', {
        sessionId,
        roomName: room.roomName,
      });

      return false;
    }

    return true;
  } catch (error) {
    // **The session is already `ACTIVE` and stays that way.** Both people can talk in
    // it as soon as 6.4 repairs the columns, and until then `hasVideo` is `false`. The
    // session id is on the line because it is the only handle an operator has for
    // "which lesson had no camera".
    logger.error('Session activated without a video room', {
      sessionId,
      code: error?.code,
      message: error?.message,
    });

    return false;
  }
}
