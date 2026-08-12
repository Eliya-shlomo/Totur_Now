import { ERROR_CODES } from '#config/errors/codes.js';
import {
  findUserForLogin,
  findUserSessionById,
  findUserWithProfile,
} from '#repositories/user.repository.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '#services/auth.token.service.js';
import { AppError } from '#utils/AppError.js';
import { burnPasswordComparison, verifyPassword } from '#utils/password.js';

/**
 * The session flow — login, refresh rotation, and the current user. MVP.md §12, §15.5.
 *
 * **Human-written, no agent** (MVP.md §17.5): this file decides who is allowed in.
 *
 * It knows nothing about `req` or `res` (CONVENTIONS.md → Server layering). Login and
 * refresh return the refresh token as a string and the controller puts it in the
 * cookie, via the one helper in `auth.token.service.js` that owns the cookie flags.
 *
 * The one idea running through all of it: **every way of failing to log in is the
 * same event to the caller.** Unknown email, wrong password and blocked account
 * produce one code, one message, one status — and, because of the dummy comparison
 * below, one duration. Any of those three differing is an account-enumeration oracle,
 * which is why PR 1.4's brief asks a reviewer to verify it rather than assume it.
 */

/**
 * The single credential failure. Built fresh per throw — `AppError` captures a stack,
 * so a shared instance would report the first failure's stack forever — but always
 * from these exact arguments, so the three call sites cannot drift apart.
 *
 * "Invalid credentials." says nothing about which half was wrong, and nothing about
 * whether the account exists. It is also what a blocked user sees: telling them the
 * account is suspended would confirm the address is registered to anyone who asks.
 */
function invalidCredentials() {
  return new AppError(ERROR_CODES.UNAUTHORIZED, 'Invalid credentials.');
}

/**
 * Row → the `AuthUser` shape in `shared/api.d.ts`, identical in login, register (1.2)
 * and `/auth/me`.
 *
 * Explicit field-by-field, never `{ ...row }` minus a key: a spread returns whatever
 * the query happened to select, so the day someone adds a column to a `select` it
 * would appear in a response, and `findUserForLogin` selects the password hash.
 * Listing the five fields means the hash cannot leak by accident, only by someone
 * typing it here.
 */
function toAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    avatarUrl: user.avatarUrl,
  };
}

/** Both tokens for a user, in one place, so login and refresh sign identically. */
function issueTokens(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

/**
 * Verifies credentials and starts a session.
 *
 * The order of the four steps is the security-critical part:
 *
 * 1. Look the user up.
 * 2. **Hash-compare either way.** Found, we compare against the real hash; not found,
 *    `burnPasswordComparison()` compares against a dummy hash of the same cost. bcrypt
 *    at cost 12 is ~250ms and dominates the request, so skipping it on the not-found
 *    path would make an unknown email answer visibly sooner than a wrong password —
 *    a timing oracle that lets anyone test whether an address has an account here.
 *    The dummy hash is computed once at module load in `utils/password.js`, so this
 *    costs one comparison, the same as the real path.
 * 3. Check `isActive` **after** the comparison, not before. Returning early for a
 *    blocked user would hand back exactly the fast answer step 2 exists to prevent.
 * 4. One error for all three failures.
 *
 * E9 blocks a user by setting `is_active = false`; this and `refreshSession` are the
 * two places that check it, because `authenticate` deliberately does not query the
 * database (see its header).
 *
 * @param {{email: string, password: string}} credentials  email already normalised by the Zod schema
 * @returns {Promise<{user: object, accessToken: string, refreshToken: string}>}
 * @throws {AppError} UNAUTHORIZED — unknown email, wrong password, or blocked account
 */
export async function loginUser({ email, password }) {
  const user = await findUserForLogin(email);

  // Both branches await one bcrypt comparison of equal cost. Deliberately not
  // collapsed into `verifyPassword(password, user?.passwordHash ?? DUMMY)`: bcrypt
  // rejects a malformed hash rather than comparing against it, which would return
  // early and reintroduce the timing difference this exists to remove.
  const passwordMatches = user
    ? await verifyPassword(password, user.passwordHash)
    : await burnPasswordComparison();

  if (!user || !passwordMatches || !user.isActive) {
    throw invalidCredentials();
  }

  return { user: toAuthUser(user), ...issueTokens(user) };
}

/**
 * Rotates a session from the refresh cookie: a new access token and a new refresh
 * token, both signed from the user's *current* database row.
 *
 * Every failure here — expired token, tampered token, deleted user, blocked user —
 * comes back as one `UNAUTHORIZED`. That is the client's contract: PR 1.5's axios
 * interceptor treats a failed refresh as "log in again", and there is nothing left to
 * retry with in any of these cases. The `TOKEN_EXPIRED` / `TOKEN_INVALID` split that
 * `verifyRefreshToken` provides is meaningful for an *access* token, where expiry
 * means "refresh me"; here both mean the same thing and are collapsed on purpose.
 *
 * **What this does not do:** invalidate the previous refresh token. These are
 * stateless JWTs, so the old cookie value stays signature-valid until its 7-day
 * `exp` — rotation replaces what the browser holds, not what an attacker copied.
 * Real revocation needs server-side state (a token version column or a denylist),
 * which means a schema change, and `prisma/schema/**` is outside this PR. It is
 * deferred to PR 1.7, auth hardening; logout has the same gap for the same reason.
 *
 * @param {string|undefined} refreshToken  the raw cookie value
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 * @throws {AppError} UNAUTHORIZED
 */
export async function refreshSession(refreshToken) {
  if (!refreshToken) {
    // No cookie at all — a logged-out browser, or one whose cookie expired. Same
    // answer as a bad one, so the client has a single "log in again" signal.
    throw invalidCredentials();
  }

  let identity;

  try {
    identity = verifyRefreshToken(refreshToken);
  } catch {
    // TOKEN_EXPIRED and TOKEN_INVALID both land here, both mean log in again.
    throw invalidCredentials();
  }

  const user = await findUserSessionById(identity.id);

  // A user deleted since the token was issued, and one blocked since, are the same
  // answer. This is the check that makes E9's block take effect inside 15 minutes:
  // the access token they already hold outlives it, the refresh cookie does not.
  if (!user || !user.isActive) {
    throw invalidCredentials();
  }

  // Signed from `user`, not from `identity`: the role in the seven-day-old token is
  // a claim about the past, and the row is the present.
  return issueTokens(user);
}

/**
 * `GET /auth/me` — the client's single source of truth for the current user.
 *
 * Everything a header or a dashboard needs, in one round trip (epic README): the user,
 * the profile their role has, and the student's balance. The role decides which keys
 * exist, so a student's response carries no `teacherProfile` key at all rather than a
 * null one — `MeResponse` marks both optional, and an absent key is unambiguous where
 * `null` reads as "they have one and it is empty".
 *
 * An admin gets the bare user: no profile row exists for the role, and the balance is
 * a student-facing number. Admins do carry a wallet row (the seed creates one), and it
 * is deliberately not reported here.
 *
 * `NOT_FOUND` rather than `UNAUTHORIZED` on a missing row: the caller's token verified,
 * so they are not unauthenticated — the account was deleted underneath a live token.
 * Rare, and worth not disguising as an auth failure when it happens.
 *
 * @param {string} userId  from `req.user.id`, so already authenticated
 * @throws {AppError} NOT_FOUND
 */
export async function getCurrentUser(userId) {
  const user = await findUserWithProfile(userId);

  if (!user) {
    throw AppError.notFound('User');
  }

  const me = toAuthUser(user);

  if (user.role === 'student') {
    // The key is emitted only when the row is really there. A profile row is created
    // in the same transaction as the user (1.2), so its absence is a data bug, and
    // inventing an empty object here would hide it behind a plausible-looking shape.
    if (user.studentProfile) me.studentProfile = user.studentProfile;

    // The balance, by contrast, does default. `undefined credits` in a header is a
    // worse failure than a wrong zero, and zero is the truthful reading of no wallet.
    me.walletBalance = user.wallet?.balance ?? 0;
  }

  if (user.role === 'teacher' && user.teacherProfile) {
    me.teacherProfile = user.teacherProfile;
  }

  return me;
}
