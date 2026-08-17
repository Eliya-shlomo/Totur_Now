import { SOCKET_EVENTS } from '@tutor/shared';

import { logger } from '#utils/logger.js';

import { getIo } from './index.js';
import { userRoom } from './rooms.js';

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
