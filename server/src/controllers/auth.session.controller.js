import { REFRESH_COOKIE_NAME } from '#config/constants/index.js';
import { getCurrentUser, loginUser, refreshSession } from '#services/auth.session.service.js';
import { clearRefreshCookie, setRefreshCookie } from '#services/auth.token.service.js';
import { takeTeacherOffline } from '#services/presence.service.js';
import { logger } from '#utils/logger.js';

/**
 * The session endpoints — login, refresh, logout, me. MVP.md §12.
 *
 * The four export names are the contract with the frozen `auth.routes.js` (PR 1.1);
 * 1.4 replaced the stub bodies and left the names alone.
 *
 * No database access and no decisions (CONVENTIONS.md → Server layering): each
 * handler calls one service function and writes the envelope. The one thing that is
 * genuinely a controller's job appears in three of them — the refresh cookie, which
 * is `res` state, and which is set and cleared through the two helpers in
 * `auth.token.service.js` so that the flags are written down exactly once.
 */

/**
 * `POST /auth/login` — 200 `{ user, accessToken }`, plus the refresh cookie.
 *
 * The body is **field-identical to 1.2's register response**, which returns 201 on
 * the same `data` object. That is deliberate and is the epic's stated risk: one
 * client-side handler serves both, so a field that exists in one and not the other
 * is a bug in whichever endpoint diverged. The `user` shape comes from a single
 * serializer in the service, which is what makes them match rather than hope.
 *
 * The refresh token is never in the body — it exists only in the httpOnly cookie
 * (§15.5), where the client's JavaScript cannot read it.
 */
export async function login(req, res) {
  const { user, accessToken, refreshToken } = await loginUser(req.body);

  setRefreshCookie(res, refreshToken);

  res.status(200).json({ success: true, data: { user, accessToken } });

  // **A teacher starts every session unavailable and says when they are ready.**
  // `status` is a column, so it survives the browser that set it: a teacher who went
  // online and closed the laptop on Tuesday was still being offered questions on
  // Thursday, and the offer had nobody to reach. Availability inherited from a session
  // that no longer exists is not consent to be sent a student.
  //
  // The write is conditional on `ONLINE` (`setTeacherOffline`), so a teacher logging in
  // on a second device while genuinely mid-offer or mid-session is untouched — those
  // states belong to the system, not to a login.
  if (user.role === 'teacher') void takeTeacherOffline(user.id);
}

/**
 * `POST /auth/refresh` — a new access token, and a rotated refresh cookie.
 *
 * No `authenticate` on this route, by design: the reason it is being called is that
 * the access token has expired. The cookie is the credential.
 *
 * **The failure path clears the cookie.** A refresh that cannot succeed leaves the
 * browser holding a value that will fail again on every retry, and PR 1.5's
 * interceptor needs one unambiguous "log in again" — so the 401 response itself
 * carries the clearing `Set-Cookie`. Clearing happens before the error propagates,
 * because `errorHandler` writes the response and nothing after it can add a header.
 */
export async function refresh(req, res) {
  let tokens;

  try {
    tokens = await refreshSession(req.cookies?.[REFRESH_COOKIE_NAME]);
  } catch (error) {
    clearRefreshCookie(res);
    throw error;
  }

  setRefreshCookie(res, tokens.refreshToken);

  res.status(200).json({ success: true, data: { accessToken: tokens.accessToken } });
}

/**
 * `POST /auth/logout` — clears the cookie. Always 200.
 *
 * Idempotent on purpose: logging out twice, or logging out having never logged in,
 * is not an error the user can act on. There is no service call because there is no
 * server-side session to end — the cookie is the session.
 *
 * It runs behind `authenticateOptional`, so `req.user` may be undefined here when the
 * access token expired in an idle tab. The cookie is cleared regardless; refusing the
 * request would leave a seven-day refresh token alive on the machine of someone who
 * just pressed "log out". `req.user` is used for the log line and nothing else.
 *
 * What this cannot do is revoke the token itself — a copy taken before logout stays
 * signature-valid until it expires. Stateless JWTs have no server-side handle to
 * revoke; PR 1.7 addresses it, and `refreshSession` carries the same note.
 */
export async function logout(req, res) {
  clearRefreshCookie(res);

  logger.debug('logout', { userId: req.user?.id });

  res.status(200).json({ success: true, data: null });

  // **A teacher who logs out stops being available, immediately.** The status column
  // used to outlive the session that set it: they went online, left, and every match
  // list went on offering them until §10's hour-long sweep noticed. A student sending
  // to that row gets a countdown that can only expire.
  //
  // After `res`, and not awaited, for the reason 5.3's email and 5.6's notification are
  // after their commit: logging out must succeed whatever the database says about a
  // profile row. `takeTeacherOffline` handles its own failures and moves nobody who is
  // `OFFER_LOCKED` or `IN_SESSION` — a live offer keeps its own clock.
  if (req.user?.role === 'teacher') void takeTeacherOffline(req.user.id);
}

/**
 * `GET /auth/me` — the current user, their role's profile, and a student's balance.
 *
 * Behind `authenticate`, so `req.user` is always `{ id, role }`. The id is used and
 * the role is not: the role comes from the database row, so a role changed since the
 * token was signed is reflected here rather than fifteen minutes from now.
 */
export async function me(req, res) {
  const user = await getCurrentUser(req.user.id);

  res.status(200).json({ success: true, data: user });
}
