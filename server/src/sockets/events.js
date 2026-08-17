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
 * raise the modal in both, and must see it clear in both.
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
 * The single point where `emit` is called, so the "no `io.emit` outside this
 * directory" rule has one line to enforce rather than five.
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
 * Addressed to the teacher's own room and not broadcast: it is how their own tabs
 * agree with each other about a pill that says ONLINE. A student watching a match
 * list does not get it — E4's list is a snapshot the student refreshes, and pushing
 * every teacher's every status change to every browsing student would be a broadcast
 * per heartbeat.
 *
 * 5.2 also uses it for the "Still there?" prompt at `AUTO_AWAY_WARNING_MINUTES`,
 * which is a status-adjacent message to one connected user and needs no second event
 * name.
 *
 * @param {string} teacherId
 * @param {{teacherId: string, status: string}} payload
 */
export function emitTeacherStatus(teacherId, payload) {
  emitToUser(teacherId, SOCKET_EVENTS.TEACHER_STATUS, payload);
}
