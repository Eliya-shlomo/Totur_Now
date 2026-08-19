import { OFFER_TTL_SECONDS, OPENING_BLOCKS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { createOffer } from '#repositories/offer.repository.js';
import {
  findSessionForOffer,
  findSessionForView,
  findTeacherForNotification,
  findWalletBalance,
  incrementOffersReceived,
  lockTeacherForOffer,
  setSessionOfferSent,
} from '#repositories/session.repository.js';
import { findTeacherById } from '#repositories/teacher.repository.js';
import { sendOfferEmail } from '#services/notification.service.js';
import { emitOfferNew, emitTeacherStatus } from '#sockets/events.js';
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
  loadTeacherContact: findTeacherForNotification,
  // `emitTeacherStatus` directly, not `publishTeacherStatus` — the same choice
  // `offer.expiry.job.js` and `presence.autoAway.job.js` each make, and for the same
  // reason. The service wrapper also calls `recordTeacherActivity(force)`, which writes
  // `last_seen_at = now`. Every caller that is entitled to do so has the **teacher** as
  // the actor: they toggled a pill, accepted an offer, opened a socket. Here the actor
  // is a **student**, and an offer arriving is not evidence that the teacher is at their
  // desk. Stamping it here told the auto-away job a teacher was present, so the teacher
  // that job exists to sweep — tab open, nobody there — had their idle clock reset by
  // other people's offers and was never swept. Found by PR 5.9's verification pass.
  announceStatus: (teacherId, status) => emitTeacherStatus(teacherId, { teacherId, status }),
  notifyTeacher: emitOfferNew,
  emailTeacher: sendOfferEmail,
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
    loadTeacherContact,
    announceStatus,
    notifyTeacher,
    emailTeacher,
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
    teacherId,
    pricePerBlock,
    loadSessionView,
    loadTeacherContact,
    announceStatus,
    notifyTeacher,
    emailTeacher,
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
 * One status broadcast, two reads and two notifications:
 *
 * **`teacher:status`** first, because E4's first hard filter is `status = 'ONLINE'` and
 * a locked teacher has just left the candidate pool. Every student with a match list
 * open is looking at a card that is now wrong.
 *
 * **It goes through `emitTeacherStatus` directly, and not through
 * `publishTeacherStatus`.** 5.3 originally called the wrapper, so that a status change
 * had one shape however it moved, and accepted the `last_seen_at` write that comes with
 * it on the grounds that it "postpones auto-away by at most one offer: harmless, and
 * better than sweeping a teacher offline while they are looking at a modal".
 *
 * PR 5.9's pass found that neither half of that holds:
 *
 * - **It is not at most one offer.** Being `ONLINE` is what makes a teacher eligible for
 *   the next offer, and every offer re-stamps the column, so the postponement renews
 *   itself for as long as students keep picking them. It does not decay.
 * - **The modal case was already covered.** A teacher with the tab open is heartbeating,
 *   and `PRESENCE_WRITE_INTERVAL_MS` is half `AUTO_AWAY_MINUTES`, so an open tab cannot
 *   go stale enough to be swept. The stamp is redundant exactly when it is safe.
 *
 * What it is not redundant for is the case the sweep exists to catch: a teacher whose
 * socket died without a clean disconnect, or who disconnected while `OFFER_LOCKED` —
 * where `takeTeacherOffline` deliberately refuses to move them. Their offer expires,
 * the release puts them back to `ONLINE`, and from then on they are an absent teacher
 * with no socket whose idle clock is reset by other people's offers, collecting requests
 * that can only expire. Auto-away is the mechanism meant to remove them, and this write
 * was the thing preventing it from ever firing.
 *
 * So this is the same call `offer.expiry.job.js` and `presence.autoAway.job.js` both
 * make, for the reason they both give: **the two jobs share one column and must not
 * write each other's inputs**, and neither may a request whose actor is a student.
 *
 * **Then the two reads, together.** The enrichment read exists for one field —
 * `findSessionForOffer` selects `topicId` and `subtopicId` but no names, and
 * `IncomingOffer.topicLabel` is a label. The contact read (5.6) exists for two fields
 * nothing else in this epic returns: `teacher_profiles.created_at`, which §5.3's
 * commission needs, and the teacher's address, which the email needs. `Promise.all`
 * rather than one after the other, because neither depends on the other and this path
 * is a teacher's sixty seconds.
 *
 * **Both reads are allowed to fail, separately.** Each catches to `null`: the label
 * degrades to `null`, which the contract types and 5.7 renders, and the email is
 * skipped. An offer that is committed and answered with 201 must not become a 500
 * because a notification could not be decorated.
 *
 * **`offer:new`** then carries `IncomingOffer` in full so that 5.7's modal renders from
 * the event rather than fetching on receipt, and **the email carries the same object**
 * — the earning in the inbox and the earning in the modal are one value, not two
 * agreeing call sites.
 *
 * **Neither notification can fail this request.** The socket emitters swallow their own
 * transport failures by contract (`sockets/events.js`), `sendOfferEmail` swallows the
 * provider's by contract (`notification.service.js`), and the email is additionally
 * **not awaited**: Resend is an HTTP call to a third party, and a student's 201 does not
 * wait on somebody else's outage. The `.catch` after it is belt and braces for the day
 * that contract is broken by a later edit — an unhandled rejection would take the
 * process down, and this one has a committed offer behind it.
 */
async function announceOffer({
  offer,
  session,
  sessionId,
  teacherId,
  pricePerBlock,
  loadSessionView,
  loadTeacherContact,
  announceStatus,
  notifyTeacher,
  emailTeacher,
}) {
  announceStatus(teacherId, 'OFFER_LOCKED');

  const [view, contact] = await Promise.all([
    loadSessionView(sessionId).catch((error) => {
      logger.warn('Offer notification could not be enriched', {
        sessionId,
        message: error?.message,
      });

      return null;
    }),
    loadTeacherContact(teacherId).catch((error) => {
      logger.warn('Offer notification could not read the teacher', {
        sessionId,
        message: error?.message,
      });

      return null;
    }),
  ]);

  const incoming = toIncomingOffer({
    offer,
    sessionId,
    question: view?.question ?? session.question,
    pricePerBlock,
    feeRate: feeRateFor(contact),
  });

  notifyTeacher(teacherId, incoming);

  emailTeacher({
    to: contact?.user?.email,
    teacherName: contact?.user?.fullName,
    offer: incoming,
  }).catch((error) => {
    logger.warn('Offer email rejected into the request path', {
      sessionId,
      message: error?.message,
    });
  });
}

/**
 * §5.3's commission for this teacher, from their own start date.
 *
 * **This is the epic README's ninth gap, closed.** 5.3 shipped with no read carrying
 * `teacher_profiles.created_at`: `TEACHER_VIEW` excludes it by explicit design and both
 * session reads are about the session, so the fallback here read as "joined just now",
 * the new-teacher exemption answered `0` for everybody and `expectedEarning` was the
 * gross. Nothing rendered it — 5.6's email and 5.7's modal are its consumers — and
 * `offer.send.test.js` pinned the wrong value in a test named for the defect, so this
 * correction broke a build rather than passing silently, which is what pinning it was
 * for. `findTeacherForNotification` supplies the column now.
 *
 * `null` when that read failed. The fallback stays `new Date()` and stays deliberate:
 * both it and the epoch are fictions, this one is a date the row could have, and it
 * fails toward quoting the teacher **more** rather than promising them less. A teacher
 * shown 15% too much on a notification the platform failed to enrich is a smaller wrong
 * than a teacher shown 15% too little, and E7 charges from the row rather than from
 * this number either way.
 */
function feeRateFor(contact) {
  return platformFeeRate({ teacherCreatedAt: contact?.createdAt ?? new Date() });
}
