import { registerUser } from '#services/auth.register.service.js';
import { setRefreshCookie } from '#services/auth.token.service.js';

/**
 * `POST /auth/register`. PR 1.2, replacing 1.1's 501 stub.
 *
 * The export name is the contract with the frozen `auth.routes.js` — the body
 * changes, the name does not.
 *
 * Everything this function knows is HTTP: which status code a creation gets, that
 * one of the two tokens travels as a cookie and the other in the body. The
 * transaction, the hashing and the duplicate-email translation are all in the
 * service, where nothing knows what a response is (CONVENTIONS.md → Server
 * layering).
 *
 * `201`, not `200`: three rows were created. The refresh token is deliberately not
 * in the body — it is set as an httpOnly cookie by the token service, which is what
 * makes it unreadable to any script on the page (§15.5).
 */
export async function register(req, res) {
  const { user, accessToken, refreshToken } = await registerUser(req.body);

  setRefreshCookie(res, refreshToken);

  // Field-identical to what `POST /auth/login` returns in 1.4 — the epic's stated
  // risk, and the reason both read their user object out of the same repository
  // selection rather than each building one.
  res.status(201).json({ success: true, data: { user, accessToken } });
}
