import { OFFER_STATUS } from '#config/constants/index.js';
import { findSessionForView } from '#repositories/session.repository.js';
import { findTeacherById } from '#repositories/teacher.repository.js';
import { AppError } from '#utils/AppError.js';
import { platformFeeRate } from '#utils/commission.js';
import { toIncomingOffer } from '#utils/offerView.js';
import { toTeacherCard } from '#utils/teacherView.js';

/**
 * `GET /sessions/:id` — one route, two shapes, decided by who is asking. PR 5.4,
 * MVP.md §12.
 *
 * **The authorisation is here and not in a middleware, and that is the point.** The
 * route carries `authenticate` and no `authorize`, because both the student and the
 * teacher read this row and *which one you are* decides what you may see. A role gate
 * could not express that: it would either lock out half the participants or say
 * nothing at all. So the rule is `req.user.id === session.studentId ||
 * === session.teacherId`, and **anybody else gets `NOT_FOUND`** — never `FORBIDDEN`,
 * which would confirm the id is real. Read as a third user, this endpoint must not
 * leak whether a session exists.
 *
 * The teacher's side carries `IncomingOffer`, the same shape 5.3 puts on `offer:new`,
 * so 5.7's modal renders from one definition whether it arrived by socket or by fetch.
 * The student's side carries `OfferResponse`, the same shape their **Send request**
 * was answered with, so 5.8's countdown survives a reload by re-reading the endpoint
 * rather than by holding the POST's body in memory.
 *
 * **Expiry is computed here too, not read off the column.** The sweeper may have been
 * asleep — the epic README's gap 6 — so a `PENDING` offer past its instant is reported
 * as `EXPIRED` to both sides. A screen that trusted `status` would show a live
 * countdown on an offer that died forty minutes ago.
 *
 * ## The student's payload when there is no offer
 *
 * A session that has never had an offer is a legitimate thing for its own student to
 * read: `POST /questions` creates it `PENDING` and E4's selection screen is where they
 * pick somebody. `OfferResponse` has no representation for "no offer yet" and
 * `shared/api.d.ts` is frozen at 5.1, so the answer is the payload's own shape with
 * `null` in every offer-derived field rather than a `404` for a session the caller
 * owns. **This is a deviation from the frozen contract's types and is written into
 * 5.4's PR description**, where a contract change belongs — not discovered by 5.8 in a
 * runtime error.
 */

/**
 * Both collaborators arrive through the second argument, 3.3's idiom — which is what
 * lets the test assert that a stranger's request never reads a teacher row at all.
 */
const defaultDeps = {
  loadSession: findSessionForView,
  loadTeacher: findTeacherById,
};

/**
 * The session, shaped for the caller.
 *
 * @param {object} input
 * @param {string} input.sessionId a uuid, already shape-checked by `sessionByIdSchema`
 * @param {string} input.userId the caller, from `req.user.id`
 * @param {object} [deps]
 * @returns {Promise<import('@tutor/shared').IncomingOffer|object>}
 */
export async function getSessionView({ sessionId, userId }, deps = defaultDeps) {
  const { loadSession, loadTeacher } = { ...defaultDeps, ...deps };

  const session = await loadSession(sessionId);

  // One answer for three different facts — no such session, somebody else's session,
  // and a typo — because telling them apart is exactly the leak. 3.5's rule, kept by
  // 4.5 and 5.3 before this.
  if (!session || (session.studentId !== userId && session.teacherId !== userId)) {
    throw AppError.notFound('Session');
  }

  // `take: 1` on `createdAt desc` in the repository, so this is the current attempt
  // and not the first one. A session collects a row per attempt — reject, pick
  // another teacher, reject again — and every consumer of this read means the latest.
  const offer = session.offers?.[0] ?? null;

  if (session.teacherId === userId) {
    return teacherView({ session, offer, sessionId });
  }

  return studentView({ session, offer, sessionId, loadTeacher });
}

/**
 * The teacher's side — `IncomingOffer`, the shape their dashboard already knows.
 *
 * A teacher reaching this route with no offer row cannot happen by construction:
 * `sessions.teacher_id` is written by `setSessionOfferSent`, in the same transaction
 * that creates the offer, and cleared by `setSessionPending` in the transaction that
 * rejects it. The guard is here anyway and answers `NOT_FOUND` rather than inventing a
 * shape the contract has no type for — a teacher with no offer is not a participant in
 * anything, and the leak rule applies to them like anyone else.
 *
 * **`expectedEarning` is the gross, for everybody, and that is a known gap.**
 * `platformFeeRate` needs `teacher_profiles.created_at` and no read reachable from E5
 * returns it — the epic README's ninth gap, found while implementing 5.3 and stated
 * there to block 5.6 and 5.7 rather than 5.4. The call is routed through
 * `platformFeeRate` anyway, with the same `new Date()` fallback 5.3 uses, so that the
 * fix is one argument at one call site rather than an arithmetic expression somebody
 * has to find.
 */
function teacherView({ session, offer, sessionId }) {
  if (!offer) {
    throw AppError.notFound('Session');
  }

  return toIncomingOffer({
    offer,
    sessionId,
    question: session.question,
    pricePerBlock: session.pricePerBlock ?? 0,
    feeRate: platformFeeRate({ teacherCreatedAt: new Date() }),
  });
}

/**
 * The student's side — `OfferResponse`, the body their **Send request** was answered
 * with, so 5.8 re-reads one shape instead of reconciling two.
 *
 * The teacher card is read separately because `findSessionForView` selects the
 * session's columns and a card is a teacher's. It is one `SELECT` on a screen that is
 * already waiting on a fetch, and it is skipped entirely when the session names no
 * teacher — which is every `PENDING` session and every one a teacher has just
 * rejected.
 *
 * A teacher row that has since been deleted degrades to `null` rather than throwing.
 * The student still owns the session and the rest of the payload is still true.
 *
 * **`questionId` is on the payload and `OfferResponse` has no such field.** Added in
 * 5.8, and it is the second deviation from the frozen contract this endpoint carries —
 * the first is the all-`null` shape described in this file's header. The reason is that
 * the awaiting screen's recovery is a link back to `/app/ask/:questionId/teachers`, and
 * that link is the point of the screen: a decline or an expiry is only tolerable
 * because the student picks somebody else in one press. Nothing else can supply the id
 * after a reload. Router state dies with the navigation, and there is no route from a
 * session to its question — `GET /questions/:id` goes the other way, and inventing the
 * reverse is a route E6 would have to honour for one string.
 *
 * `shared/api.d.ts` is frozen at 5.1, so the type is not amended; the deviation is
 * written here and in 5.8's PR description, where a contract change belongs.
 */
async function studentView({ session, offer, sessionId, loadTeacher }) {
  const teacher = session.teacherId ? await loadTeacher(session.teacherId) : null;
  const status = offer ? effectiveOfferStatus(offer) : null;

  return {
    offerId: offer?.id ?? null,
    sessionId,
    questionId: session.questionId,
    status,
    expiresAt: offer?.expiresAt?.toISOString() ?? null,
    teacher: teacherCardFor({ teacher, status }),
    pricePerBlock: session.pricePerBlock ?? null,
  };
}

/**
 * The teacher's card for the student's side, **and the one field this read cannot take
 * from the row as it stands.**
 *
 * `toTeacherCard` computes `isOnline` as `status === 'ONLINE'`, and a teacher holding a
 * `PENDING` offer is `OFFER_LOCKED` — locked *by this very offer*. So the card reads
 * "Offline" on the awaiting screen, which tells the student they sent their question to
 * somebody who is not there. They are there; they are holding it, and the countdown
 * beside the pill is the proof.
 *
 * `offerView.js` already makes this call for `POST /sessions/:id/offer`, where it passes
 * the teacher row read *before* the lock and says why in a paragraph. This read happens
 * after the lock and has no pre-lock row to reach for, so the same answer is written
 * here instead. Without it the two endpoints disagree about one boolean, and 5.4's whole
 * argument for answering the student with the `OfferResponse` shape is that a reload
 * lands on the same screen the POST produced.
 *
 * **Only while the offer is `PENDING`.** Once it is answered or dead the row's own status
 * is the true one — a teacher who declined and went back to `ONLINE` is online, and one
 * who closed their laptop is not.
 */
function teacherCardFor({ teacher, status }) {
  if (!teacher) return null;

  const card = toTeacherCard(teacher);

  return status === OFFER_STATUS.PENDING ? { ...card, isOnline: true } : card;
}

/**
 * What the offer's status *is*, rather than what the column last got around to saying.
 *
 * `PENDING` past `expiresAt` reads `EXPIRED`, because the sweeper is allowed to be
 * asleep and both screens make a decision from this field — 5.8 runs a countdown on
 * it and 5.7 raises a modal. Every other value is a decision somebody made and is
 * reported unchanged; an `ACCEPTED` offer does not stop being accepted when its
 * original deadline passes.
 */
function effectiveOfferStatus(offer) {
  if (offer.status === OFFER_STATUS.PENDING && offer.expiresAt.getTime() <= Date.now()) {
    return OFFER_STATUS.EXPIRED;
  }

  return offer.status;
}
