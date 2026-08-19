import { findOfferSessionForTeacher } from '#repositories/session.repository.js';
import { getSessionView } from '#services/session.view.service.js';
import { emitOfferNew } from '#sockets/events.js';
import { logger } from '#utils/logger.js';

/**
 * The offer a teacher already has when their socket connects — the delivery fix on top
 * of 5.8.
 *
 * ## The defect
 *
 * `offer:new` is a live frame and nothing catches it when nobody is listening. A
 * teacher who logs in after the student pressed **Send request** — or who reloads, or
 * whose laptop slept through the emit — holds the lock and sees no modal. The header
 * says "Offer pending", the availability control refuses to move, and there is nothing
 * on the screen to accept. From the student's side the offer simply expires. 5.7 wrote
 * this off as "no rehydrate on reload... wiring it is a later PR's"; testing the epic
 * end to end is what made it a bug rather than a scope decision.
 *
 * ## Why the handshake and not a fetch on mount
 *
 * The dashboard would need to know it has an offer before it can ask about one, and
 * nothing it already reads carries that — `GET /teachers/me` answers a status, not a
 * session id. Closing it from the client therefore costs a new endpoint or a new field
 * on a frozen response type, and it still only covers the mount: a socket that drops at
 * minute three and reconnects at minute four has the same hole, and no screen remounts
 * to notice.
 *
 * The handshake covers every one of those cases with one read, because *connecting* is
 * exactly the moment a client becomes able to hear anything at all.
 *
 * ## It replays the same event rather than inventing one
 *
 * `offer:new` again, with the identical `IncomingOffer` payload, addressed to the
 * teacher's room by `events.js` like every other emit in the server — no second event
 * name for "the offer you already had", and no emitter that takes a socket. The
 * dashboard drops a frame whose `offerId` matches the modal it is already showing, so
 * a second tab connecting does not disturb the first.
 *
 * A replay is therefore indistinguishable from the original at the client, which is the
 * property that makes this safe: there is one way an offer reaches a teacher, and one
 * modal that renders it.
 */

/**
 * Re-announces a live offer to a teacher who has just connected.
 *
 * **Nothing here can throw into the connection.** A failed replay must cost the modal,
 * never the socket — a teacher whose handshake rejected because of a slow query would
 * lose presence, heartbeats and every future offer to fix a missed one. So the whole
 * body is wrapped and a failure logs at `error`: this is the epic's characteristic
 * silent failure and it should be visible in a log.
 *
 * **Nothing is replayed to a student.** They have no modal, and their screen re-reads
 * `GET /sessions/:id` on mount, which is the same fix arriving by a different road.
 *
 * `getSessionView` decides what a teacher may see, including the expiry it evaluates on
 * every read, so an offer that died while the server was asleep answers `EXPIRED`
 * rather than a countdown — and it is not replayed. Sending it would raise a modal that
 * closes itself a beat later with "that question expired", which is a worse experience
 * than the silence it replaced.
 *
 * @param {import('socket.io').Socket} socket an authenticated socket
 * @returns {void}
 */
export function replayOpenOffer(socket) {
  const { id: userId, role } = socket.data.user;

  if (role !== 'teacher') return;

  void (async () => {
    try {
      const session = await findOfferSessionForTeacher(userId);

      if (!session) return;

      const offer = await getSessionView({ sessionId: session.id, userId });

      // The row said `OFFER_SENT` and the offer under it is already dead — the sweeper
      // has not reached it yet. 5.5's tick will settle the row within seconds; there is
      // nothing to show in the meantime.
      if (!offer?.expiresAt || new Date(offer.expiresAt).getTime() <= Date.now()) return;

      emitOfferNew(userId, offer);

      logger.info('Replayed an open offer to a reconnecting teacher', {
        userId,
        offerId: offer.offerId,
      });
    } catch (error) {
      logger.error('Could not replay an open offer', { userId, message: error?.message });
    }
  })();
}
