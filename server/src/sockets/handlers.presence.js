import { SOCKET_EVENTS } from '@tutor/shared';

import { recordTeacherActivity } from '#services/presence.service.js';

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
