import { createUserWithProfileAndWallet } from '#repositories/user.repository.js';
import { signAccessToken, signRefreshToken } from '#services/auth.token.service.js';
import { AppError } from '#utils/AppError.js';
import { hashPassword } from '#utils/password.js';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Registration. MVP.md §12, §18/E1.6.
 *
 * The service owns the decision that a registration is one indivisible thing —
 * user, profile and wallet — and hands the how to the repository. It knows nothing
 * about `req` or `res` (CONVENTIONS.md): it takes a validated payload and returns
 * the two tokens plus the user, and the controller decides that one of those
 * tokens becomes a cookie.
 *
 * Registration logs the user straight in. That is the epic's frozen contract and
 * not a convenience: a signup flow that then asks for the same password again is a
 * form abandoned halfway, and returning the same `{ user, accessToken }` shape as
 * login means the client has one handler for both.
 */

/**
 * @param {{ email: string, password: string, fullName: string,
 *          role: 'student' | 'teacher', grade?: number, mathLevel?: number }} input
 *   already validated and normalised by `auth.register.schema.js`
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
 * @throws {AppError} VALIDATION_ERROR when the email is taken
 */
export async function registerUser({ email, password, fullName, role, grade, mathLevel }) {
  // Hashed before the transaction opens, never inside it. bcrypt at 12 rounds is
  // deliberately expensive — a few hundred milliseconds — and doing it inside
  // `$transaction` would hold a database connection open for all of it, which
  // turns the pool into the bottleneck under exactly the load registration sees
  // when a class signs up together.
  const passwordHash = await hashPassword(password);

  const user = await createUserWithProfileAndWallet({
    email,
    passwordHash,
    fullName,
    role,
    grade,
    mathLevel,
  }).catch(rethrowDuplicateEmail);

  // Signed from the created row, not from the input: `id` exists only after the
  // insert, and `role` is what the database stored rather than what was asked for.
  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

/**
 * A duplicate email is a form error, not a server failure.
 *
 * Checking the email first and then inserting would still race: two requests for
 * the same address can both pass the check and both reach the insert, and only the
 * unique index decides. So the index is the check, and this translates its answer
 * into the field-level shape the register form renders inline.
 *
 * The Prisma code is not passed through. `P2002` means nothing to a user, and an
 * unmapped one would reach the error handler as a non-operational error — a 500,
 * for someone who simply already has an account.
 */
function rethrowDuplicateEmail(error) {
  if (error?.code === UNIQUE_VIOLATION && mentionsEmail(error.meta?.target)) {
    throw AppError.validation('Some fields need fixing.', {
      email: 'That email is already registered.',
    });
  }

  throw error;
}

/**
 * `meta.target` is an array of column names on some Prisma versions and the
 * constraint name (`users_email_key`) as a string on others. Both are handled
 * because guessing wrong turns the friendly 400 above into a 500, and only in
 * production, and only for a user who already has an account.
 */
function mentionsEmail(target) {
  if (Array.isArray(target)) return target.includes('email');

  return typeof target === 'string' && target.includes('email');
}
