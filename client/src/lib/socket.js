import { ERROR_CODES, SOCKET_EVENTS } from '@tutor/shared';
import { io } from 'socket.io-client';

import { useAuthStore } from '@/stores/authStore';

/**
 * The app's one Socket.IO connection — PR 5.7, MVP.md §13.
 *
 * **One connection per tab, not one per screen.** A hook that called `io()` on mount
 * would open a second socket every time a route changed, and every event addressed to
 * this user would arrive twice: two `offer:new` frames raise the modal twice, and the
 * second one looks exactly like the double-booking bug this epic exists to prevent.
 * So the socket is module state, created once, and screens reach it through
 * `useSocketEvent` — which only ever adds and removes listeners.
 *
 * **Why `lib/` and not `api/`.** Everything in `api/` is a request function over the
 * one axios instance, frozen at a 15-second timeout since E1. A persistent
 * bidirectional connection has a different lifecycle and a different failure mode, and
 * filing it beside `teacher.api.js` would suggest a symmetry that does not exist.
 *
 * **The lifecycle is driven by the auth store, not by a component.** Connecting from a
 * `useEffect` somewhere would tie the socket to whichever screen happened to mount
 * first, and a teacher who navigates away from that screen would stop hearing offers.
 * `useAuthStore.subscribe` below is the whole of it: a session appears, the socket
 * connects; the session ends, it disconnects.
 *
 * **App-wide, not teacher-only.** 5.8's student screen listens for `offer:accepted`
 * and `offer:rejected` on this same singleton. Only the heartbeat is role-gated.
 */

/**
 * How often a connected teacher says it is still there — `teacher:heartbeat`, 5.2.
 *
 * The server debounces the write to half of `AUTO_AWAY_MINUTES`, so this number does
 * not decide how often `last_seen_at` moves; it decides how quickly a teacher who came
 * back stops looking gone. A minute is well inside the hour-long window the column
 * exists to answer questions about, and costs one tiny frame per teacher per minute.
 */
const HEARTBEAT_MS = 60_000;

/**
 * What counts as the teacher still being there.
 *
 * **A heartbeat means the teacher is active, not that the tab is open** — the rule is
 * written on `sockets/handlers.presence.js`, and this is the client it was written
 * against. A bare `setInterval` would keep `last_seen_at` fresh for a browser left open
 * on a closed laptop, nobody would ever be swept, and §10's auto-away would be dead on
 * arrival while looking implemented.
 *
 * `visibilitychange` is in the list because returning to a backgrounded tab is the
 * clearest statement a teacher can make that they are back at the machine, and it is
 * the event a phone actually fires when the screen wakes.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'visibilitychange'];

/**
 * Where the socket connects — the server's **origin**, not the API base path.
 *
 * `VITE_SOCKET_URL` first, and in production it is the only answer that works — PR
 * 6b.2. HTTP is proxied through the client's own origin so that the refresh cookie is
 * first-party, which makes `VITE_API_URL` the relative `/api/v1`; **Vercel's rewrites
 * do not carry a WebSocket upgrade**, so the socket cannot follow it there and has to
 * name the Render origin itself. The two transports diverge here and nowhere else.
 *
 * The socket does not need the cookie, which is what makes the split possible at all:
 * the handshake presents the access token through the `auth` callback below, and the
 * server verifies it in `sockets/auth.js`. `withCredentials` stays on for the CORS
 * preflight, not for a credential this connection depends on.
 *
 * Falling back to `VITE_API_URL` keeps development working unchanged — both sides are
 * localhost, `http://localhost:3000/api/v1` yields the right origin, and Socket.IO
 * mounts at `/socket.io` on the origin rather than under the versioned API prefix.
 * `new URL(...).origin` throws on a relative base, and `window.location.origin` is the
 * last resort: correct when the API is genuinely this origin, wrong behind a proxy,
 * which is why the variable exists rather than being inferred.
 */
function socketOrigin() {
  const configured = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL;

  try {
    return new URL(configured || window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

/** The one socket. Created lazily so importing this module opens no connection. */
let socket = null;

/** The heartbeat timer, or `null` when there is nothing to beat for. */
let heartbeatTimer = null;

/** Whether the teacher has done anything since the last tick. See `ACTIVITY_EVENTS`. */
let activeSinceLastBeat = false;

/**
 * Guards the refresh-and-reconnect path below, so a refresh cookie that is gone
 * cannot turn every failed handshake into another `/auth/refresh` call.
 */
let refreshingToken = false;

/**
 * The connection, created on first use.
 *
 * `autoConnect: false` because the store decides when there is a session to connect
 * with — the default would fire a handshake with no token during app bootstrap and
 * get refused for a reason that is not an error.
 *
 * **`auth` is a callback, not an object.** Socket.IO calls it before every connection
 * attempt, so a reconnect after a token refresh presents the *current* token. An
 * object literal would capture whatever the token was when this module first ran,
 * which is a socket that reconnects forever with a credential that expired at minute
 * fifteen.
 *
 * @returns {import('socket.io-client').Socket}
 */
export function getSocket() {
  if (socket) return socket;

  socket = io(socketOrigin(), {
    autoConnect: false,
    withCredentials: true,
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
  });

  socket.on('connect', startHeartbeat);
  socket.on('disconnect', stopHeartbeat);
  socket.on('connect_error', onConnectError);

  return socket;
}

/**
 * A refused handshake — `sockets/auth.js` sends the `AppError` code in `err.data`.
 *
 * `TOKEN_EXPIRED` is the recoverable one and it is the same seam `api/client.js` has
 * for HTTP: refresh once, then let the reconnect present the new token through the
 * `auth` callback. Anything else — a tampered token, a server that is down — is left
 * to Socket.IO's own backoff. The HTTP layer owns logging the user out; a socket that
 * cannot connect must not be a second thing that redirects.
 */
function onConnectError(error) {
  if (error?.data?.code !== ERROR_CODES.TOKEN_EXPIRED || refreshingToken) return;

  refreshingToken = true;

  useAuthStore
    .getState()
    .refresh()
    .then(() => {
      if (useAuthStore.getState().accessToken) socket?.connect();
    })
    .catch(() => {
      // The refresh cookie is gone or refused. The next authenticated HTTP call
      // reaches `onAuthLost` and sends the user to /login; nothing useful happens
      // here, and retrying would be the storm this flag exists to prevent.
    })
    .finally(() => {
      refreshingToken = false;
    });
}

/**
 * Start beating, for teachers only.
 *
 * Students and admins have a socket for the events addressed to them and no
 * `last_seen_at` to move — the server's handler checks the role too, because the
 * handler is the boundary and this is only the client being polite.
 *
 * No beat is sent immediately: `sockets/index.js` already writes `last_seen_at` when a
 * teacher connects, so an instant first beat would be a second write of a value that
 * was just written.
 *
 * **A tick with no interaction behind it sends nothing**, which is the contract
 * described on `ACTIVITY_EVENTS`. The flag is cleared by the beat it causes, so one
 * click buys one heartbeat and a teacher who then walks away goes quiet on the next
 * tick rather than an hour later.
 */
function startHeartbeat() {
  stopHeartbeat();

  if (useAuthStore.getState().user?.role !== 'teacher') return;

  for (const event of ACTIVITY_EVENTS) {
    document.addEventListener(event, markActive, { passive: true });
  }

  heartbeatTimer = window.setInterval(() => {
    if (!activeSinceLastBeat) return;

    activeSinceLastBeat = false;
    socket?.emit(SOCKET_EVENTS.TEACHER_HEARTBEAT);
  }, HEARTBEAT_MS);
}

/** Stop beating — on disconnect, on logout, and before starting a new timer. */
function stopHeartbeat() {
  for (const event of ACTIVITY_EVENTS) {
    document.removeEventListener(event, markActive);
  }

  activeSinceLastBeat = false;

  if (heartbeatTimer === null) return;

  window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/**
 * The teacher did something. `visibilitychange` fires on the way out as well as the way
 * back, and a tab being hidden is not activity — hence the check rather than a bare
 * assignment.
 */
function markActive() {
  if (document.visibilityState === 'hidden') return;

  activeSinceLastBeat = true;
}

/**
 * Connect or disconnect to match the session.
 *
 * **A live connection is left alone when the access token rotates.** The token is
 * verified once, at the handshake, and the connection it produced does not become
 * unauthenticated fifteen minutes later — tearing it down every refresh would drop a
 * teacher's offers for the length of a reconnect, four times an hour, to prove
 * something the server never asks again. The refreshed token is picked up by the
 * `auth` callback the next time a handshake actually happens, which is what the
 * reconnect path above is for.
 *
 * @param {{status: string, accessToken: string|null}} state
 */
function syncConnection({ status, accessToken }) {
  const authenticated = status === 'authenticated' && Boolean(accessToken);

  if (!authenticated) {
    stopHeartbeat();
    socket?.disconnect();

    return;
  }

  const live = getSocket();

  if (!live.connected) live.connect();
}

/**
 * The subscription that runs the whole lifecycle, established when this module is
 * first imported.
 *
 * `getState()` first, because bootstrap may already have answered by the time a screen
 * imports this file: a subscriber only hears about the *next* change, and the session
 * that is already open would never connect.
 *
 * Logout also does a full page load (`authStore`), which drops the socket with
 * everything else — but the store transition is what makes this correct without
 * depending on that, and `authStore` is not a file this PR opens.
 */
useAuthStore.subscribe(syncConnection);

syncConnection(useAuthStore.getState());
