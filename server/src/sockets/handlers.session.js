import { SOCKET_EVENTS } from '@tutor/shared';

import { findParticipants } from '#repositories/session.repository.js';
import { logger } from '#utils/logger.js';

import { sessionRoom } from './rooms.js';

/**
 * `session:join` — the epic's one client → server event, and the only place in this
 * codebase where a socket joins a second room. PR 6.2.
 *
 * ## Why this handler exists at all, when `user:{userId}` never needed one
 *
 * Every socket is put in `user:{userId}` by `auth.js`, at handshake time, from an
 * identity the token already proved. **That room cannot be wrong**, and there is
 * nothing for a client to ask for.
 *
 * `session:{sessionId}` is the opposite in every respect. The client names the room,
 * the name is a uuid, and uuids travel — they are in URLs, in logs, in screenshots, in
 * the address bar of a shared screen. So the id arriving here is an assertion and not a
 * fact, and this handler's entire job is to check it against the database before the
 * socket is allowed to hear anything addressed to that session.
 *
 * **A room name is not a capability.** The events that land in this room are a block
 * warning carrying a balance, an extension carrying what was charged, and the end of a
 * session carrying why. None of it is a stranger's to read.
 *
 * ## The check is the same rule `GET /sessions/:id/video` uses
 *
 * The caller is the session's `student_id` or its `teacher_id`. Not a role — both roles
 * pass, and which one you are is not the question. 6.4's endpoint asks the database the
 * same thing about the same row, and the two must not drift: an endpoint that refuses
 * and a socket that admits is the socket becoming the way around the endpoint.
 *
 * **Participation is checked before `socket.join`, never after.** After is a window,
 * however short, in which a stranger is in the room and an emit landing in that window
 * reaches them. There is no cleanup that closes a frame already sent.
 *
 * ## A refusal sends nothing back
 *
 * No error event, no reason, no acknowledgement — the socket is left exactly as it was.
 * This is 6.4's `404` in a different transport and it is the same argument: an
 * "unauthorised" reply confirms the session exists, so a stranger holding a uuid learns
 * something by asking. Silence tells them nothing, and there is no legitimate client
 * that ever reaches this path — 6.7 joins the session it just fetched.
 *
 * The three causes — no such session, not `ACTIVE`, not yours — are distinguishable in
 * the **log**, at `warn`, with the caller's id. They are not distinguishable over the
 * wire.
 *
 * ## Nothing here can throw into the socket
 *
 * `handlers.offer.js`'s rule, for the same reason: a failed join must cost the room,
 * never the connection. A socket that dropped because a read was slow would lose
 * presence, heartbeats and every future event to fix one missed room.
 */

/**
 * Wires the `session:join` listener onto a freshly connected socket.
 *
 * **Registered for every socket, both roles.** A student and a teacher are equally
 * participants in a session; unlike `teacher:heartbeat`, there is no role that can be
 * refused at the boundary, because the boundary here is a row and not a role.
 *
 * `socket.data.user` is `{ id, role }`, guaranteed by `auth.js` before any connection
 * exists, so it is read without a guard.
 *
 * @param {import('socket.io').Socket} socket an authenticated socket
 * @returns {void}
 */
export function registerSessionHandlers(socket) {
  const { id: userId } = socket.data.user;

  socket.on(SOCKET_EVENTS.SESSION_JOIN, async (payload) => {
    // The payload is whatever the client sent. `validate` is Express middleware and
    // there is none of it here, so the shape is checked at the top of the handler
    // rather than assumed — an object destructure on a string is not an error, it is
    // `undefined`, and `undefined` reaching Prisma as a uuid is a `22P02` on a query
    // this handler had no business making.
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null;

    if (!sessionId) {
      logger.warn('session:join with no session id', { userId, socketId: socket.id });
      return;
    }

    try {
      const session = await findParticipants(sessionId);

      // Three causes, three log lines, one behaviour: nothing goes back.
      if (!session) {
        logger.warn('session:join for a session that does not exist', { userId, sessionId });
        return;
      }

      if (session.studentId !== userId && session.teacherId !== userId) {
        logger.warn('session:join by somebody who is not in the session', { userId, sessionId });
        return;
      }

      // Joined **after** the check and not before. See the header.
      //
      // The status is deliberately not a condition. A participant reloading an `ENDED`
      // session is on 6.7's summary screen waiting for a rating, and refusing them the
      // room would cost the events that screen is built on for the sake of a rule the
      // room does not need — everything addressed here is already addressed to people
      // this read has confirmed. It is logged so the join is legible in a trace.
      socket.join(sessionRoom(sessionId));

      logger.debug('Socket joined session room', {
        userId,
        sessionId,
        status: session.status,
        socketId: socket.id,
      });
    } catch (error) {
      // A failed join costs the room, never the connection.
      logger.error('session:join failed', { userId, sessionId, message: error?.message });
    }
  });
}
