import { SOCKET_EVENTS } from '@tutor/shared';

import { PRESENCE_DISCONNECT_GRACE_SECONDS } from '#config/constants/index.js';
import { recordTeacherActivity, takeTeacherOffline } from '#services/presence.service.js';
import { logger } from '#utils/logger.js';

import { getIo } from './index.js';
import { userRoom } from './rooms.js';

/**
 * `teacher:heartbeat` — the only client → server event in the epic. PR 5.2.
 *
 * **A heartbeat means the teacher is active, not that the tab is open.** This is the
 * contract 5.7's client is written against, and it is the difference between §10's
 * auto-away working and being dead on arrival: a client that beats on a bare
 * `setInterval` keeps `last_seen_at` fresh for a browser left open on a closed laptop,
 * and no teacher is ever swept. The client therefore beats on the interval **only when
 * there has been user interaction since the last beat**. The server cannot tell the
 * two apart and does not try — which is exactly why the rule is written down on the
 * handler rather than left in the client that implements it.
 *
 * **The heartbeat is answered with nothing.** No acknowledgement, no response event,
 * no payload in either direction. A heartbeat that answers is a request, and it would
 * be one round trip per teacher per interval carrying information nobody reads.
 *
 * **Nothing here can throw into the socket.** `recordTeacherActivity` handles its own
 * failures, so there is no `try` below and no `.catch` — adding either would suggest
 * the guarantee is softer than it is.
 */

/**
 * Wires the heartbeat listener onto a freshly connected socket, and marks the teacher
 * present immediately.
 *
 * **The role is checked here, at the boundary, and a student gets no listener at all.**
 * A student's client has no reason to emit this — 5.7 only starts the beat on the
 * teacher dashboard — but the client is not where that is enforced, because anybody
 * holding a valid student token can open a socket and emit whatever they like. With no
 * listener registered, `teacher:heartbeat` from a student reaches nothing: no write, no
 * error, no disconnect. Socket.IO drops an event with no handler silently, which is the
 * correct answer to a message that is merely pointless rather than hostile.
 *
 * The forced write on connect is the other half of the heartbeat's semantics: opening
 * the dashboard is interaction, and waiting a full interval to record it would leave a
 * teacher who reconnects at minute 59 looking an hour idle.
 *
 * `socket.data.user` is `{ id, role }`, guaranteed by `auth.js` before any connection
 * exists, so it is read without a guard.
 *
 * @param {import('socket.io').Socket} socket an authenticated socket
 * @returns {void}
 */
export function registerPresenceHandlers(socket) {
  const { id: userId, role } = socket.data.user;

  if (role !== 'teacher') return;

  void recordTeacherActivity(userId, { force: true });

  socket.on(SOCKET_EVENTS.TEACHER_HEARTBEAT, () => {
    void recordTeacherActivity(userId);
  });
}

/**
 * Takes a teacher offline once their last tab has been gone for the grace period — the
 * presence fix on top of 5.8.
 *
 * **This is the case a logout button cannot cover.** Nobody clicks log out; they close
 * the laptop. The status column then went on saying `ONLINE` until §10's hour-long
 * sweep, and every match list in the meantime offered a teacher who could not answer.
 *
 * **Why a grace period rather than acting on the disconnect.** A reload is a disconnect.
 * So is switching networks, and so is a phone locking. Taking the teacher offline
 * immediately would drop them off every list several times an hour for events that
 * changed nothing — and the reconnect does not put them back, because going online is a
 * deliberate act. So the disconnect only schedules a question: after
 * `PRESENCE_DISCONNECT_GRACE_SECONDS`, *is there still no socket?*
 *
 * **The check is "no sockets in this user's room", not "this socket is gone".** A
 * teacher with the dashboard in two windows closes one and is still there; a teacher
 * who quits the browser closes both. The room is the same one `events.js` addresses,
 * so what is asked here is exactly "could an offer reach them".
 *
 * No timer bookkeeping: a reconnect inside the window makes the check find a socket and
 * do nothing, and two disconnects schedule two checks whose answer is the same.
 * `takeTeacherOffline` moves nobody who is `OFFER_LOCKED` or `IN_SESSION` and emits only
 * when the row actually changed, so a duplicate is a no-op rather than a second frame.
 *
 * @param {import('socket.io').Socket} socket the socket that just disconnected
 * @returns {void}
 */
export function scheduleOfflineIfLastSocket(socket) {
  const { id: userId, role } = socket.data.user;

  if (role !== 'teacher') return;

  setTimeout(() => {
    void (async () => {
      try {
        const sockets = await getIo().in(userRoom(userId)).fetchSockets();

        if (sockets.length > 0) return;

        await takeTeacherOffline(userId);
      } catch (error) {
        // Includes a socket server torn down between the disconnect and this callback,
        // which is every deploy. Nothing to recover: 5.5's sweep is the backstop.
        logger.warn('Could not check for a teacher’s remaining sockets', {
          userId,
          message: error?.message,
        });
      }
    })();
  }, PRESENCE_DISCONNECT_GRACE_SECONDS * 1000).unref?.();
}
