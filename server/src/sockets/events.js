import { SOCKET_EVENTS } from '@tutor/shared';

import { logger } from '#utils/logger.js';

import { getIo } from './index.js';
import { sessionRoom, userRoom } from './rooms.js';

/**
 * One function per server → client event. **The only place in `server/src` that
 * emits.**
 *
 * That is a rule with a grep behind it — `io.emit` and `socket.emit` appear nowhere
 * else in the server, and 5.1's acceptance criteria say so — and the reason is that
 * an event which does not arrive has exactly three possible causes: it was never
 * emitted, it went to the wrong room, or the client is not listening. With emitters
 * scattered through controllers, finding out which one takes reading every
 * controller. With this file, the first two are answered by reading one function.
 *
 * **Every function ships in 5.1 and none is called until 5.2.** A payload decided
 * once, in the PR that froze the contract, is what makes 5.2 through 5.8 one-line
 * consumers rather than eight separate inventions of what an offer looks like on the
 * wire.
 *
 * Three properties they all share:
 *
 * **They take a recipient, never a socket.** Addressed to a person, delivered to
 * every tab that person has open. A teacher with the dashboard in two windows must
 * raise the modal in both, and must see it clear in both. `emitTeacherStatus` is the
 * one exception and it still takes an id rather than a socket — see its header for
 * why it goes to everybody.
 *
 * **They never throw into the caller.** Every one of these is a side effect of a
 * transaction that has already committed. An offer that 500s because a socket server
 * hiccuped is a worse product than an offer whose notification was missed — the same
 * shape 5.6's email takes, and E3's classifier fallback before it. A failure logs and
 * returns.
 *
 * **The names come from `@tutor/shared`.** Never a literal: the client switches on
 * the same strings, and two drifting lists is a bug no type checker in this repo
 * would catch.
 */

/**
 * Emits to one user's room, swallowing a transport failure.
 *
 * The single point where an addressed `emit` is called, so the "no `io.emit` outside
 * this directory" rule has one line to enforce rather than five. `emitTeacherStatus`
 * is the one function that does not go through it, because it is the one event with
 * no recipient — it writes its own two lines rather than taking a room name it would
 * have to invent.
 *
 * @param {string} userId
 * @param {string} event one of SOCKET_EVENTS
 * @param {object} payload
 */
function emitToUser(userId, event, payload) {
  try {
    getIo().to(userRoom(userId)).emit(event, payload);
    logger.debug('Socket event emitted', { event, userId });
  } catch (error) {
    // Includes the case where the socket server was never initialised. Logged at
    // `error` because it means a user silently did not hear about something, which
    // is this epic's characteristic failure and is invisible from the client side.
    logger.error('Socket emit failed', { event, userId, message: error?.message });
  }
}

/**
 * `offer:new` — a student picked this teacher. 5.3 calls it after the offer
 * transaction commits; 5.7's dashboard raises the modal on it.
 *
 * The payload is the contract's `IncomingOffer` in full, including `expiresAt`, so
 * the modal's countdown recomputes from an absolute server-issued instant on every
 * tick. A payload carrying "60 seconds" instead would leave the teacher's clock
 * disagreeing with the server's about when the offer died.
 *
 * @param {string} teacherId
 * @param {import('@tutor/shared').IncomingOffer} offer
 */
export function emitOfferNew(teacherId, offer) {
  emitToUser(teacherId, SOCKET_EVENTS.OFFER_NEW, offer);
}

/**
 * `offer:expired` — nobody answered in time.
 *
 * Sent to **both** sides, in two calls from 5.5's sweep: the teacher's modal has to
 * close and the student's countdown has to become "nobody answered — pick somebody
 * else". Two calls rather than one function taking two ids, because the two are
 * separate facts to the emitter and one of them may be absent — the sweep runs
 * against rows whose student may have closed the tab.
 *
 * @param {string} userId the teacher or the student
 * @param {{offerId: string, sessionId: string}} payload
 */
export function emitOfferExpired(userId, payload) {
  emitToUser(userId, SOCKET_EVENTS.OFFER_EXPIRED, payload);
}

/**
 * `offer:accepted` — to the **student**, who is watching a countdown and needs it to
 * become the session screen. 5.4 emits it after the accept transaction commits.
 *
 * The teacher is not told: they are the one who pressed accept and already have the
 * HTTP response. An event to both would race that response, and 5.8's screen would
 * have two sources of truth for the same transition.
 *
 * @param {string} studentId
 * @param {{offerId: string, sessionId: string}} payload
 */
export function emitOfferAccepted(studentId, payload) {
  emitToUser(studentId, SOCKET_EVENTS.OFFER_ACCEPTED, payload);
}

/**
 * `offer:rejected` — to the **student**, whose screen goes back to E4's list.
 *
 * The teacher who declined is the teacher who pressed the button, for the same
 * reason accept does not tell them.
 *
 * @param {string} studentId
 * @param {{offerId: string, sessionId: string}} payload
 */
export function emitOfferRejected(studentId, payload) {
  emitToUser(studentId, SOCKET_EVENTS.OFFER_REJECTED, payload);
}

/**
 * `teacher:status` — a teacher's availability changed. 5.2's, and the one event here
 * that is not about a specific offer.
 *
 * **This one goes to every connected socket, and the reason is that there is nowhere
 * else to send it.** §13 addresses it to "students in selection", and E5 has no such
 * room: the only room in the epic is `user:{userId}`, joined at handshake time from
 * the verified identity, and a student browsing a match list is not identified by
 * anything the server can turn into a room name. The alternative is a room per
 * teacher that students join when a match list renders and leave when it does not —
 * a subscription lifecycle, with a join, a leave, a reconnect path and a leak when
 * the leave is missed. At fifteen teachers and a demo, the honest implementation is
 * to send it to everybody and let each client ignore the ids it is not looking at.
 *
 * **This is a scale-shaped decision, not a permanent one.** The payload carries no
 * secret — a teacher's availability is on their public card as `isOnline` — so
 * broadcasting it leaks nothing. What it costs is one frame per connected socket per
 * status change, which is fine while status changes are toggles and offers and awful
 * if a heartbeat ever starts emitting one. **Nothing in 5.2 emits from the heartbeat
 * path**, and that is the invariant to keep: if a future PR wants per-beat status,
 * the room per teacher has to be built first.
 *
 * The teacher's own tabs are inside "everybody", so the pill on their dashboard still
 * agrees with itself across windows.
 *
 * `teacherId` stays in the payload as well as being the parameter, because the
 * recipient is no longer the subject: every client receives every teacher's changes
 * and has to know whose this is.
 *
 * @param {string} teacherId whose status moved — in the payload, not the address
 * @param {{teacherId: string, status: string}} payload
 */
export function emitTeacherStatus(teacherId, payload) {
  try {
    getIo().emit(SOCKET_EVENTS.TEACHER_STATUS, payload);
    logger.debug('Socket event broadcast', { event: SOCKET_EVENTS.TEACHER_STATUS, teacherId });
  } catch (error) {
    // Same swallow as `emitToUser`, for the same reason: this is a side effect of a
    // committed write, and a status change that 500s because the socket server
    // hiccuped is a worse product than a pill that is stale until the next fetch.
    logger.error('Socket broadcast failed', {
      event: SOCKET_EVENTS.TEACHER_STATUS,
      teacherId,
      message: error?.message,
    });
  }
}

// ── E6 ───────────────────────────────────────────────────────────────────────
//
// Five emitters, **all shipped here in 6.2 and none called until 6.5.** The same
// arrangement 5.1 made for its five, and the reason held: a payload decided once, in
// the PR that froze the contract, is what makes 6.5 and 6.6 one-line consumers rather
// than two separate inventions of what "the session ended" looks like on the wire.
//
// The three properties above still hold, with one addition. Four of the five address a
// **session** rather than a person, because these events are about a session and both
// participants need them at the same instant — a warning that reached the student and
// not the teacher is two people watching different clocks while one of them decides
// whether to spend. `emitTeacherAwayWarning` is the exception and it is addressed to a
// person, because it is about that person and the other side has no business seeing it.

/**
 * Emits to one session's room, swallowing a transport failure.
 *
 * `emitToUser`'s counterpart, and the second and last place in this directory where an
 * addressed `emit` is called. Same swallow, same reason: every one of these is a side
 * effect of a transaction that has already committed, and a charge that 500s because a
 * socket hiccuped is a worse product than a modal that arrives late.
 *
 * **Delivery is to whoever is in the room, and nobody is in it who was not checked.**
 * `handlers.session.js` is the only thing that joins it, after reading the session's
 * participants out of the database. This function does no check of its own and must not
 * grow one — a second place that decides who may hear about a session is a second place
 * to get it wrong.
 *
 * @param {string} sessionId
 * @param {string} event one of SOCKET_EVENTS
 * @param {object} payload
 */
function emitToSession(sessionId, event, payload) {
  try {
    getIo().to(sessionRoom(sessionId)).emit(event, payload);
    logger.debug('Socket event emitted', { event, sessionId });
  } catch (error) {
    logger.error('Socket emit failed', { event, sessionId, message: error?.message });
  }
}

/**
 * `session:block_warning` — the current block ends in `WARNING_SECONDS`. 6.5's cron
 * emits it; 6.7's screen raises the extend modal on it.
 *
 * **The server decides all four numbers.** `canAfford` and `withinCap` are not the
 * client's to compute: a screen that works out affordability works it out differently
 * from the endpoint that enforces it, and the disagreement shows up as an extend button
 * that is enabled and then 402s.
 *
 * To both sides. The teacher does not press the button, but a teacher who does not know
 * the session is about to end is a teacher who starts explaining something.
 *
 * @param {string} sessionId
 * @param {{secondsLeft: number, extensionPrice: number, balanceAfter: number,
 *          canAfford: boolean, withinCap: boolean}} payload
 */
export function emitBlockWarning(sessionId, payload) {
  emitToSession(sessionId, SOCKET_EVENTS.SESSION_BLOCK_WARNING, payload);
}

/**
 * `session:extended` — a block was bought. 6.5 emits it after the charge commits.
 *
 * **`endsAt` is absolute, server-issued and the only clock**, exactly as `expiresAt`
 * was in E5's countdown. A payload carrying "five more minutes" would leave a
 * backgrounded tab and a reload disagreeing with the server about when the session
 * ends, and this one has money behind it.
 *
 * `balance` rides along because it is the reason §13's `wallet:updated` is not in E6's
 * contract: the session screen is the only screen showing a balance, and it is already
 * listening to this.
 *
 * @param {string} sessionId
 * @param {{blocksUsed: number, endsAt: string, totalCharged: number, balance: number}} payload
 */
export function emitSessionExtended(sessionId, payload) {
  emitToSession(sessionId, SOCKET_EVENTS.SESSION_EXTENDED, payload);
}

/**
 * `session:ended` — it is over, and why. 6.6 emits it after the termination commits;
 * 6.5's auto-end sweep is rewired through the same path.
 *
 * To both sides, and this is the one event where that is not a convenience: whichever
 * of the two did not press the button has no HTTP response coming and would otherwise
 * sit on a screen counting down a session that has already been billed and closed.
 *
 * `endReason` is one of §11.2's six values and the screen renders it, so the same
 * ending does not read as an error to one participant and a choice to the other.
 * `actorId` is carried because the column deliberately does not record it — both sides
 * write `student_ended` — and the screen wants to say who.
 *
 * @param {string} sessionId
 * @param {{endReason: string, endedAt: string, actorId: string|null}} payload
 */
export function emitSessionEnded(sessionId, payload) {
  emitToSession(sessionId, SOCKET_EVENTS.SESSION_ENDED, payload);
}

/**
 * `session:participant_left` — the other person's last socket went away mid-session.
 * E5 README, gap 11, deferred to E6 because a fix with no screen to show it on is a
 * state change nobody can see. 6.8 wires the detection; 6.7 owns what it looks like.
 *
 * **This is not the end of the session and must never be mistaken for one.** A dropped
 * tunnel and a closed laptop are indistinguishable from here, and E5 already learned
 * that a reload is also a disconnect — `PRESENCE_DISCONNECT_GRACE_SECONDS` exists
 * because of it. The meter keeps running, the money has already moved, and the person
 * still on the screen is told the other side went quiet so they can decide whether to
 * end it.
 *
 * @param {string} sessionId
 * @param {{userId: string, role: 'student'|'teacher'}} payload who left
 */
export function emitParticipantLeft(sessionId, payload) {
  emitToSession(sessionId, SOCKET_EVENTS.SESSION_PARTICIPANT_LEFT, payload);
}

/**
 * `teacher:away_warning` — "still there?" at `AUTO_AWAY_WARNING_MINUTES`. 6.5's
 * reopened auto-away job emits it.
 *
 * **The constant has been unread since E0 and this is its first reader.** It was 5.2's,
 * then 5.5's, then nobody's, and E5's README has the whole argument: the blocker was
 * never the query. It was that appending an event name is a contract change rather than
 * a job, and `teacher:status` with an unchanged status is a no-op every existing
 * handler already ignores. 6.2 appended the E6 block anyway, so the name cost one line.
 *
 * **Addressed to the teacher, through `emitToUser`, and it is the one E6 emitter that
 * is.** It is about that teacher's idleness, it fires whether or not they are in a
 * session, and a student has no business being told the person teaching them looks
 * asleep.
 *
 * @param {string} teacherId
 * @param {{minutesUntilAway: number}} payload
 */
export function emitTeacherAwayWarning(teacherId, payload) {
  emitToUser(teacherId, SOCKET_EVENTS.TEACHER_AWAY_WARNING, payload);
}

/**
 * `wallet:updated` — credit arrived. 7.3 calls it after the top-up commits; 7.5's wallet
 * screen sets the balance from it.
 *
 * **After the commit, never inside.** 6.3's room creation, 6.5's `session:extended` and
 * 6.6's `session:ended` all made this call, and the reason is the same every time: an
 * emit inside a transaction tells a client about a balance that may still roll back, and
 * there is no second event to take it back with.
 *
 * **The only emitter of this name, and top-up is its only caller.** A charge and a refund
 * do not raise it — they happen inside `wallet.service.js`, where an emit would be inside
 * somebody else's transaction, and the screen that shows a balance during a session is
 * already told by `session:block_warning` and `session:extended`.
 *
 * **The payload is the balance and not the delta.** A client that added a delta to a
 * number it was holding would drift the first time it missed a frame; an absolute figure
 * computed by the same transaction that wrote the row cannot. Same argument `endsAt` and
 * `expiresAt` already won.
 *
 * @param {string} userId
 * @param {{balance: number}} payload
 */
export function emitWalletUpdated(userId, payload) {
  emitToUser(userId, SOCKET_EVENTS.WALLET_UPDATED, payload);
}
