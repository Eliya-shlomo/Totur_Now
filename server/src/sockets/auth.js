import { verifyAccessToken } from '#services/auth.token.service.js';
import { logger } from '#utils/logger.js';

import { userRoom } from './rooms.js';

/**
 * The Socket.IO handshake. A JWT in, an authenticated connection or a refusal out.
 *
 * **Human-written, no agent** (MVP.md §17.5, docs/epics/E5-offers-realtime/README.md).
 * §17.5 puts auth middleware on the human-written list, and this is auth middleware:
 * it is the only thing standing between a socket and every event addressed to a user.
 * Read it line by line in review, the same way `middlewares/authenticate.js` asks to
 * be read — a bug here is silent, and it is silent in the direction that lets the
 * wrong person listen.
 *
 * Four properties this file exists to guarantee.
 *
 * **The token is verified by the same function HTTP uses.** `verifyAccessToken` from
 * `auth.token.service.js`, which is what `middlewares/authenticate.js` calls. Not a
 * second `jwt.verify` with its own options — two verifiers is two policies, and the
 * second one is the one nobody remembers to update when the first gets an
 * `issuer` check or a clock-tolerance change. The import line above is the proof, and
 * it is a review item.
 *
 * **The token comes from the handshake auth payload and from nowhere else.** Not
 * `socket.handshake.query`, which lands in the URL and therefore in every access log,
 * every proxy, and the browser's own history. Not a first message after connecting:
 * "connect anonymously and authenticate later" means there is a window in which an
 * unauthenticated socket exists, and every later `if (!socket.data.user)` is a chance
 * to forget. There is no such window here.
 *
 * **A failed handshake refuses the connection.** `next(err)` and the socket never
 * connects; the client gets `connect_error` rather than a connected socket in a
 * degraded state. No anonymous fallback, no read-only mode.
 *
 * **The room is joined here, from the verified identity.** Not from anything the
 * client sent. A socket that could name its own room could name somebody else's and
 * receive their offers, which is the bug this whole file is arranged to prevent.
 */

/**
 * Socket.IO middleware: verify, attach, join.
 *
 * `socket.data.user` is `{ id, role }` and nothing more — the same shape `req.user`
 * carries, so a handler that works with one works with the other and nothing has to
 * learn a second convention.
 *
 * The `AppError` code from the verifier is passed through in `err.data` because the
 * client distinguishes them: `TOKEN_EXPIRED` means refresh and reconnect,
 * `TOKEN_INVALID` means log out. Socket.IO sends `err.message` and `err.data` to the
 * client and drops everything else, so this is the one channel available — and it
 * carries a code the client already switches on, never a stack or a reason.
 *
 * Failures log at `warn` with the socket id and the code, and never the token. A
 * refused handshake is a thing worth seeing in the logs — it is either a client bug
 * or somebody trying — and `logger`'s redact list would strip the token even if this
 * file tried to log it.
 *
 * @param {import('socket.io').Socket} socket
 * @param {(err?: Error) => void} next
 */
export function socketAuth(socket, next) {
  // Optional chaining because `auth` is client-supplied: a client that connects with
  // no auth payload at all must be refused, not crash the middleware.
  const token = socket.handshake.auth?.token;

  if (!token || typeof token !== 'string') {
    logger.warn('Socket handshake refused — no token', { socketId: socket.id });
    return next(unauthorized('You need to be logged in.', 'UNAUTHORIZED'));
  }

  let user;

  try {
    user = verifyAccessToken(token);
  } catch (error) {
    // `verifyAccessToken` throws `AppError` with TOKEN_EXPIRED or TOKEN_INVALID and
    // nothing else. The code is forwarded; the message is the AppError's own, which
    // is already written to be safe to show a user.
    logger.warn('Socket handshake refused — bad token', {
      socketId: socket.id,
      code: error?.code,
    });
    return next(unauthorized(error?.message ?? 'That session token is not valid.', error?.code));
  }

  socket.data.user = user;
  socket.join(userRoom(user.id));

  logger.debug('Socket connected', { socketId: socket.id, userId: user.id, role: user.role });

  return next();
}

/**
 * A refusal Socket.IO will actually deliver.
 *
 * `next()` wants an `Error`, and Socket.IO forwards only `message` and `data` from it
 * to the client's `connect_error` handler. `AppError` is not used here because its
 * `code` and `statusCode` would be dropped on the way out and an HTTP status means
 * nothing on a socket — the code the client needs is put in `data` explicitly rather
 * than hoping the transport carries a property it does not.
 *
 * @param {string} message
 * @param {string} [code] one of ERROR_CODES, for the client to switch on
 * @returns {Error}
 */
function unauthorized(message, code) {
  const error = new Error(message);
  error.data = { code };
  return error;
}
