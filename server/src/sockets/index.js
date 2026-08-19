import { Server } from 'socket.io';

import { env } from '#config/env.js';
import { logger } from '#utils/logger.js';

import { socketAuth } from './auth.js';
import { replayOpenOffer } from './handlers.offer.js';
import { registerPresenceHandlers, scheduleOfflineIfLastSocket } from './handlers.presence.js';

/**
 * The Socket.IO server. Created in PR 5.1, and **it emits nothing until 5.2.**
 *
 * Every emitter exists in `events.js` and none is called yet. That is deliberate: it
 * makes 5.2 through 5.8 one-line consumers of a payload that was decided once, rather
 * than each inventing its own, and it means the handshake — the part that is a
 * security boundary — is reviewed on its own instead of inside an L-sized dashboard
 * diff.
 *
 * **Bound to the HTTP server Express already listens on**, not to a second port.
 * Socket.IO upgrades an HTTP connection, so it needs the same listener; a second one
 * would need a second Render service, a second URL and a second CORS list.
 *
 * The `#sockets/*` import alias has been in `server/package.json` since E0 and this is
 * the PR that uses it.
 */

/**
 * The one `Server` instance, held so `events.js` can reach it without every emitter
 * being handed one.
 *
 * Module-level rather than exported directly, so that reading it before
 * `initSockets` has run is a thrown error naming the problem instead of `undefined`
 * with a property access on it three frames away.
 */
let io = null;

/**
 * Creates the socket server on an existing HTTP server. Called once, from
 * `server/src/index.js`, after `app.listen`.
 *
 * **CORS is `env.corsOrigins` — the same list Express uses, not a second one.**
 * Socket.IO does not read Express's `cors()` middleware; the handshake is its own
 * HTTP request with its own preflight, so an origin list left off here means either a
 * client that cannot connect or, if written as `'*'`, a wildcard with credentials on.
 * `DEPLOYMENT.md` §6 warns about exactly that for Express and the warning does not
 * stop being true one layer down. A literal here would also be a second place to edit
 * the day the client moves domain, and the two would drift.
 *
 * `credentials: true` matches `app.js` for the same reason it is on there.
 *
 * `socketAuth` runs before any connection is established, so there is no moment at
 * which an unauthenticated socket exists. The `connection` handler below can
 * therefore assume `socket.data.user` without checking, and it does not check —
 * a defensive `if` there would suggest the guarantee is softer than it is.
 *
 * @param {import('node:http').Server} httpServer the server `app.listen` returned
 * @returns {import('socket.io').Server}
 */
export function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
  });

  io.use(socketAuth);

  io.on('connection', (socket) => {
    // `teacher:heartbeat` — the only client → server event in the epic, added in 5.2.
    // A student's socket gets no listener at all; the role check is inside, at the
    // boundary, rather than here where every later handler would have to repeat it.
    registerPresenceHandlers(socket);

    // The offer this teacher is already holding, if there is one. `offer:new` is a
    // live frame and nothing catches it when the teacher's socket did not exist yet —
    // logging in after the student pressed **Send request** is the ordinary way to
    // hold a lock with no modal on screen. Fire-and-forget, and it cannot throw: see
    // the file's header for why a failed replay must never cost the connection.
    replayOpenOffer(socket);

    socket.on('disconnect', (reason) => {
      logger.debug('Socket disconnected', {
        socketId: socket.id,
        userId: socket.data.user.id,
        reason,
      });

      // A teacher whose last tab has gone stops being available — after a grace period,
      // because a reload is also a disconnect. See the handler for why the check is
      // "any socket left in this user's room" rather than "this one closed".
      scheduleOfflineIfLastSocket(socket);
    });
  });

  logger.info('Socket.IO listening', { corsOrigins: env.corsOrigins });

  return io;
}

/**
 * The server, for `events.js` and for the shutdown handler.
 *
 * Throws rather than returning null when it is called too early. A socket server that
 * is silently absent is a feature that silently does not work — an offer that never
 * reaches a dashboard, with no error line anywhere — and this epic's whole failure
 * mode is events that do not arrive.
 *
 * @returns {import('socket.io').Server}
 */
export function getIo() {
  if (!io) {
    throw new Error('Socket.IO is not initialised — initSockets(server) has not run.');
  }

  return io;
}

/**
 * Closes every connection and stops the server. Called from the shutdown handler
 * before `server.close()`.
 *
 * Ordering matters: `server.close()` waits for connections to end, and a WebSocket is
 * a connection that by design never ends on its own. Draining HTTP first would hang
 * until the ten-second force-exit fires on every single deploy.
 *
 * A no-op when the server was never created, so shutdown works if the process is
 * killed during boot.
 */
export async function closeSockets() {
  if (!io) return;

  await io.close();
  io = null;
}
