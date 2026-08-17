import { OFFER_TTL_SECONDS, OPENING_BLOCKS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { createOffer } from '#repositories/offer.repository.js';
import {
  findSessionForOffer,
  findSessionForView,
  findWalletBalance,
  incrementOffersReceived,
  lockTeacherForOffer,
  setSessionOfferSent,
} from '#repositories/session.repository.js';
import { findTeacherById } from '#repositories/teacher.repository.js';
import { publishTeacherStatus } from '#services/presence.service.js';
import { emitOfferNew } from '#sockets/events.js';
import { AppError } from '#utils/AppError.js';
import { platformFeeRate } from '#utils/commission.js';
import { logger } from '#utils/logger.js';
import { toIncomingOffer, toOfferResponse } from '#utils/offerView.js';

/**
 * **The atomic teacher lock** — `POST /sessions/:id/offer`. PR 5.3, MVP.md §11.3
 * transaction A, and the one thing this epic is built around.
 *
 * Everything from 5.4 on assumes the invariant *a teacher has at most one `PENDING`
 * offer*. If the conditional `updateMany` behind `lockTeacherForOffer` is wrong, a
 * teacher gets two offers, accepts both, and two students are charged for one person's
 * time — **and every test in this repository still passes**, because they all run one
 * request at a time. The verification for this file is two browsers, on the day it
 * merges, not `npm test`.
 *
 * ## The order, and why it is the design
 *
 * ```
 *   pre-flight (reads)
 *     1. the session, or NOT_FOUND — never FORBIDDEN, which would confirm the id
 *     2. still PENDING, or SESSION_NOT_ACTIVE
 *     3. the teacher, or TEACHER_UNAVAILABLE
 *     4. balance >= pricePerBlock x OPENING_BLOCKS, or INSUFFICIENT_CREDIT
 *   BEGIN
 *     5. lockTeacherForOffer   -> locked: false  =>  TEACHER_UNAVAILABLE, roll back
 *     6. createOffer           at now + OFFER_TTL_SECONDS
 *     7. setSessionOfferSent   -> count 0        =>  SESSION_NOT_ACTIVE, roll back
 *     8. incrementOffersReceived
 *   COMMIT
 *     9. teacher:status, then offer:new
 * ```
 *
 * **The lock is taken first inside the transaction so that everything after it is
 * already exclusive**, and the two failures that are not the lock are settled before
 * it so that a doomed request never takes one. A broke student who reached step 5
 * would leave a teacher locked for sixty seconds; that is the ordering the brief's
 * review checklist asks about by name.
 *
 * **Nothing awaits an external service inside the callback.** No email, no socket
 * emit, no `fetch`. Each of those would hold a row-level exclusive lock on
 * `teacher_profiles` for the duration of somebody else's outage, and an offer that
 * 500s because Resend is down is a worse product than an offer with no email. The two
 * announcements below the commit are side effects of a transaction that has already
 * succeeded, and both emitters swallow their own failures by contract.
 *
 * **The failure path rolls back; it never compensates.** There is no `catch` here that
 * sets a teacher back to `ONLINE` by hand — that would be a second lock implementation
 * with worse semantics. Every throw inside the callback aborts the transaction, and
 * Postgres undoes the lock, the offer row and the session transition together.
 *
 * ## Two deviations from the layering, both deliberate
 *
 * **This service imports `prisma`, for `$transaction` and nothing else.** CONVENTIONS.md
 * puts every line of Prisma behind the repository layer and `config/db.js` says so in
 * as many words, and `user.repository.js` rules that a transaction belongs in the
 * repository that owns its statements. It cannot here: `session.repository.js` was
 * frozen at 5.1 with exactly one permitted gap — `lockTeacherForOffer`'s body — and a
 * `withOfferTransaction` added to it now would be a frozen file reopened, which is the
 * failure the freeze exists to prevent. The narrower breach is one import in one
 * service, and it arrives through `defaultDeps` as `runTransaction` so that the seam
 * is visible rather than buried mid-function. **The service still decides that sending
 * an offer is atomic; it does not decide how any statement is written.**
 *
 * **`incrementOffersReceived` runs inside the transaction**, where
 * `session.repository.js` documents it and where its required `tx` parameter puts it.
 * 5.3's brief argues for outside, on the grounds that a denormalised statistic adds a
 * second row to the write set of the most contended transaction in the product — but
 * it is the *same* `teacher_profiles` row the lock is already holding exclusively, so
 * it adds no row, no lock and no contention, and inside means a rolled-back offer
 * cannot leave the counter incremented. §9.2 reads this column as the acceptance rate
 * and 4.8's retro records it as history that stopped; this is where it restarts.
 *
 * Every collaborator arrives through the second argument — 3.3's idiom, and what lets
 * `offer.send.test.js` assert the calls that *did not* happen with no database at all.
 */
const defaultDeps = {
  findSession: findSessionForOffer,
  findBalance: findWalletBalance,
  findTeacher: findTeacherById,
  runTransaction: (fn) => prisma.$transaction(fn),
  lockTeacher: lockTeacherForOffer,
  writeOffer: createOffer,
  markOfferSent: setSessionOfferSent,
  countOffer: incrementOffersReceived,
  loadSessionView: findSessionForView,
  announceStatus: publishTeacherStatus,
  notifyTeacher: emitOfferNew,
};

/**
 * Sends one offer — `OfferResponse`, 201, or one of four operational errors.
 *
 * @param {object} input
 * @param {string} input.sessionId a uuid, already shape-checked by `sendOfferSchema`
 * @param {string} input.studentId the caller, from `req.user.id` — never a body's
 * @param {string} input.teacherId the teacher the student picked, from the body
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').OfferResponse>}
 */
export async function sendOffer({ sessionId, studentId, teacherId }, deps = defaultDeps) {
  const {
    findSession,
    findBalance,
    findTeacher,
    runTransaction,
    lockTeacher,
    writeOffer,
    markOfferSent,
    countOffer,
    loadSessionView,
    announceStatus,
    notifyTeacher,
  } = { ...defaultDeps, ...deps };

  const session = await loadOwnedSession({ sessionId, studentId, findSession });

  assertSessionIsPending(session);

  const teacher = await findTeacher(teacherId);

  // A teacher id that resolves to nothing — an unknown uuid, a student's id, a user
  // with no `teacher_profiles` row. `TEACHER_UNAVAILABLE` rather than `NOT_FOUND`, for
  // the reason every ownership check in this codebase answers `NOT_FOUND` rather than
  // `FORBIDDEN`: the server does not confirm which ids are real. It is also what the
  // student's screen does next either way — refresh the list and pick somebody else.
  if (!teacher) {
    throw new AppError(
      ERROR_CODES.TEACHER_UNAVAILABLE,
      'That teacher is no longer available. Here are others.',
    );
  }

  // **Read from the teacher's own row, never from the request body.** `sendOfferSchema`
  // is `.strict()` and refuses a price, and this is the other half of that rule: a
  // price that arrives from the client is a price the client can choose. This one value
  // is snapshotted onto the session, reported in the response and used for the
  // affordability check, so all three agree by construction.
  const { pricePerBlock } = teacher;

  assertCanAffordOpeningBlock({ balance: (await findBalance(studentId)) ?? 0, pricePerBlock });

  // Computed once, here, and it reaches the column, the HTTP response and the socket
  // payload as the same instant. A TTL recomputed per reader is three clocks — see
  // `createOffer`'s header — and it is the service's number rather than the
  // repository's because how long a teacher has to answer is a product rule.
  const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000);

  const offer = await runTransaction(async (tx) => {
    // §11.3's mechanism, and the four lines the epic rests on. Under Postgres's
    // default READ COMMITTED the second transaction blocks on the row until the first
    // commits, then re-evaluates its `WHERE`, sees `OFFER_LOCKED` and matches zero.
    // No `isolationLevel` is passed anywhere in this file: SERIALIZABLE would also
    // work and would add retry handling for a problem this does not have.
    const { locked } = await lockTeacher(teacherId, tx);

    if (!locked) {
      // **`info`, not `error`. Losing this race is the product working**, and it is
      // the single most interesting event in this epic — `errorHandler` logs every
      // operational error at `debug`, which is below the production threshold, so the
      // one line that would explain a 409 under load would not be there to read.
      logger.info('Offer lost the teacher lock', { sessionId, studentId, teacherId });

      throw new AppError(
        ERROR_CODES.TEACHER_UNAVAILABLE,
        'That teacher is no longer available. Here are others.',
      );
    }

    const created = await writeOffer({ sessionId, teacherId, expiresAt }, tx);

    const { count } = await markOfferSent({ sessionId, teacherId, pricePerBlock }, tx);

    // Zero means the session stopped being `PENDING` between the pre-flight read and
    // here — two **Send request** presses that both passed the status check, which a
    // reload makes an ordinary user action rather than an attack. The second one must
    // lose, and it loses by rolling back everything above it including the lock.
    if (count === 0) {
      throw new AppError(
        ERROR_CODES.SESSION_NOT_ACTIVE,
        'This question already has a request out to a teacher.',
      );
    }

    await countOffer(teacherId, tx);

    return created;
  });

  await announceOffer({
    offer,
    session,
    sessionId,
    teacher,
    teacherId,
    pricePerBlock,
    loadSessionView,
    announceStatus,
    notifyTeacher,
  });

  return toOfferResponse({ offer, sessionId, teacher, pricePerBlock });
}

/**
 * The session, or `NOT_FOUND` — and the same answer for a stranger's session.
 *
 * `findSessionForOffer` deliberately does not filter on `studentId`; the comparison is
 * here, in the service, because a `where` on the student would make "someone else's"
 * and "does not exist" indistinguishable from each other and from a typo. 3.5 and 4.5
 * both make this call, with the same message on both branches — `FORBIDDEN` would
 * confirm the id is real, and while a uuid is unguessable the leak is free to avoid.
 */
async function loadOwnedSession({ sessionId, studentId, findSession }) {
  const session = await findSession(sessionId);

  if (!session || session.studentId !== studentId) {
    throw AppError.notFound('Session');
  }

  return session;
}

/**
 * `PENDING`, or `SESSION_NOT_ACTIVE` (409).
 *
 * E4's selection screen disables the other cards while an offer is in flight, and a
 * reload re-enables every one of them — so a second **Send request** on a session that
 * already has an offer out is a real request from an ordinary user, and without this it
 * is a way to double-book a student. 409 rather than 404 because none of this is a
 * missing resource: it is a state the request collided with, and one that may well be
 * different a minute from now.
 */
function assertSessionIsPending(session) {
  if (session.status !== 'PENDING') {
    throw new AppError(
      ERROR_CODES.SESSION_NOT_ACTIVE,
      'This question already has a request out to a teacher.',
    );
  }
}

/**
 * `balance >= pricePerBlock × OPENING_BLOCKS`, or `INSUFFICIENT_CREDIT` (402).
 *
 * **A read of `wallets`, and it crosses no seam.** E4 applied a ceiling when the match
 * list was built; between that screen and this button the balance could in principle
 * have moved. One `SELECT` closes the gap. This PR calls no wallet service and moves no
 * money — `wallet.service.js` is E7's and §17.5 marks it human-written because a bug
 * there creates or destroys real money.
 *
 * The opening block is `OPENING_BLOCKS` and not one block, because §5.1 charges it
 * immediately and makes it non-cancellable: a student who can afford five minutes but
 * not ten cannot start this session at all.
 *
 * `null` from the wallet read is coalesced to `0` by the caller. Every registered
 * student gets a wallet, so an absent row is a data problem rather than a poor student
 * — but it is not a reason to let them start a session they cannot pay for.
 */
function assertCanAffordOpeningBlock({ balance, pricePerBlock }) {
  if (balance < pricePerBlock * OPENING_BLOCKS) {
    throw new AppError(
      ERROR_CODES.INSUFFICIENT_CREDIT,
      'You do not have enough credits for the opening block. Top up to continue.',
    );
  }
}

/**
 * Everything that happens **after** `COMMIT`, and nothing that happens before it.
 *
 * Two announcements, in this order:
 *
 * **`teacher:status`** first, because E4's first hard filter is `status = 'ONLINE'` and
 * a locked teacher has just left the candidate pool. Every student with a match list
 * open is looking at a card that is now wrong. It goes through `publishTeacherStatus`
 * rather than the emitter directly so that a status change has one shape and one
 * emitter however it moved — 5.2 owns that decision and says 5.3 calls it. It also
 * counts the lock as activity and refreshes `last_seen_at`, which postpones auto-away
 * by at most one offer: harmless, and better than sweeping a teacher offline while they
 * are looking at a modal.
 *
 * **`offer:new`** second, carrying `IncomingOffer` in full so that 5.7's modal renders
 * from the event rather than fetching on receipt.
 *
 * **Neither can fail this request.** Both emitters swallow their own transport
 * failures by contract (`sockets/events.js`), and the one thing here that can reject —
 * the enrichment read — is caught to `null`. An offer that is committed and answered
 * with 201 must not become a 500 because a notification could not be decorated.
 *
 * **The enrichment read exists for one field.** `findSessionForOffer` selects `topicId`
 * and `subtopicId` but no names, and `IncomingOffer.topicLabel` is a label. This is one
 * `SELECT` on the notification path, off the hot path and outside every lock, against a
 * query 5.1 already froze. When it fails the payload falls back to the session already
 * in hand and the label degrades to `null`, which the contract types and 5.7 renders.
 */
async function announceOffer({
  offer,
  session,
  sessionId,
  teacher,
  teacherId,
  pricePerBlock,
  loadSessionView,
  announceStatus,
  notifyTeacher,
}) {
  announceStatus(teacherId, 'OFFER_LOCKED');

  const view = await loadSessionView(sessionId).catch((error) => {
    logger.warn('Offer notification could not be enriched', {
      sessionId,
      message: error?.message,
    });

    return null;
  });

  notifyTeacher(
    teacherId,
    toIncomingOffer({
      offer,
      sessionId,
      question: view?.question ?? session.question,
      pricePerBlock,
      feeRate: feeRateFor(teacher),
    }),
  );
}

/**
 * §5.3's commission for this teacher — **and the one number in this PR that is
 * currently a placeholder. It is `0` for everybody.**
 *
 * `platformFeeRate` needs `teacher_profiles.created_at`, and **no read reachable from
 * this PR returns it.** `TEACHER_VIEW` excludes it by explicit design — the header of
 * `teacher.repository.js` lists the columns it refuses to select and that file is E2's
 * and frozen — and `findSessionForOffer` and `findSessionForView` are both about the
 * session. So `teacher.createdAt` is `undefined` on every row that reaches here, the
 * fallback below reads as "joined just now", and the new-teacher exemption answers `0`
 * every time. 5.3 was kept inside its permitted file list rather than unfreezing a
 * repository to fix it, which is the right trade for a field 5.3 itself never renders.
 *
 * **What that costs, stated plainly:** `IncomingOffer.expectedEarning` is the gross,
 * not the net. Nothing in this PR shows it to anybody — 5.7's modal and 5.6's email are
 * its consumers and neither exists — and 5.3's acceptance criteria do not assert it. It
 * must be corrected before either lands, because `commission.js`'s header is explicit
 * that the number a teacher is shown at accept time is the one E7 has to honour, and
 * an established teacher quoted the gross would be shown 15% more than they earn.
 *
 * The fix is one function: a teacher read owned by E5 that carries `createdAt`, in
 * `session.repository.js`, as its own small PR — which is exactly the procedure that
 * file's own header prescribes for a query discovered missing. It is a note in the epic
 * README and a blocker on 5.6, not a silent `TODO`.
 *
 * The fallback is `new Date()` rather than the epoch on purpose. Both are fictions; this
 * one is at least a date the row could have, and it fails toward paying the teacher
 * more rather than promising them less, which is the safer direction to be wrong in
 * while the number reaches no screen.
 */
function feeRateFor(teacher) {
  return platformFeeRate({ teacherCreatedAt: teacher.createdAt ?? new Date() });
}
