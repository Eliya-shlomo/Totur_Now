import { z } from 'zod';

/**
 * The client mirror of the server's auth validation — PR 1.3, mirroring 1.2's
 * `server/src/validators/auth.register.schema.js` and 1.4's `auth.session.schema.js`.
 *
 * **This file adds no rule the server does not enforce.** A rule that exists only
 * here is a rule that is not enforced, since anything can post to the API directly.
 * It exists to fail fast on the phone rather than after a round trip, and every
 * constraint below has a line-for-line counterpart on the server.
 *
 * The constants are duplicated rather than imported: they live in
 * `server/src/config/constants/{auth,user,teacher}.js`, which the client cannot
 * reach, and `@tutor/shared` exports types plus `ERROR_CODES` only. Changing one of
 * them on the server means changing it here — the two files are named in each
 * other's comments so the pair is greppable.
 */

/** `PASSWORD_MIN_LENGTH` — server/src/config/constants/auth.js */
export const PASSWORD_MIN_LENGTH = 8;

/** `EMAIL_MAX_LENGTH` — `users.email VARCHAR(255)`. */
const EMAIL_MAX_LENGTH = 255;

/** `FULL_NAME_MIN_LENGTH` / `FULL_NAME_MAX_LENGTH` — `users.full_name VARCHAR(100)`. */
const FULL_NAME_MIN_LENGTH = 2;
const FULL_NAME_MAX_LENGTH = 100;

/** The login schema's cap. Keeps a megabyte of text out of a deliberately slow hash. */
const LOGIN_PASSWORD_MAX_LENGTH = 200;

/** `STUDENT_GRADES` — Israeli high school, the Bagrut years. */
export const STUDENT_GRADES = [10, 11, 12];

/** `MATH_LEVELS` — Bagrut units, an alias of `TEACHING_LEVELS`. */
export const MATH_LEVELS = [3, 4, 5];

/** The two roles this endpoint can mint. `admin` is not one of them, by construction. */
export const ROLES = ['student', 'teacher'];

/**
 * Trimmed and lowercased in the same order the server does it.
 *
 * The normalisation is not cosmetic: Postgres compares `VARCHAR` case-sensitively,
 * so `Bob@x.com` registered from a phone with autocapitalise on is an account that
 * `bob@x.com` can never log into. Both schemas normalise, so both agree.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(EMAIL_MAX_LENGTH, 'That email is too long.');

/**
 * An optional numeric choice arriving from a Mantine `Select`, which hands back a
 * string or `null` and never a number.
 *
 * Blank means "not answered" rather than "invalid" — grade and level sharpen
 * matching (§9.1) rather than gate it, and a student who has not decided should not
 * be stopped at the door. The server has these as `.optional()` for the same reason.
 */
const optionalChoice = (allowed, message) =>
  z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : Number(value)),
    z
      .number()
      .int()
      .refine((value) => allowed.includes(value), { message })
      .optional(),
  );

/**
 * `POST /auth/register`, shaped for the register form's values rather than for the
 * wire.
 *
 * One deliberate divergence from the server schema, and it is the only one: the
 * server is a `discriminatedUnion` of two `.strict()` branches, so a teacher sending
 * `grade` is rejected outright. A form cannot be a union — its values object always
 * carries every field, and a user who filled in a grade and then switched to
 * "I want to teach" keeps that value in state. {@link toRegisterPayload} is what
 * honours `.strict()`: it drops the student-only keys for a teacher, so the request
 * body always matches exactly one branch of the server's union.
 */
export const registerSchema = z.object({
  email,
  password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`),
  fullName: z
    .string()
    .trim()
    .min(FULL_NAME_MIN_LENGTH, 'Enter your full name.')
    .max(FULL_NAME_MAX_LENGTH, 'That name is too long.'),
  role: z.enum(ROLES),
  grade: optionalChoice(STUDENT_GRADES, `Grade must be one of ${STUDENT_GRADES.join(', ')}.`),
  mathLevel: optionalChoice(MATH_LEVELS, `Level must be one of ${MATH_LEVELS.join(', ')}.`),
});

/**
 * `POST /auth/login`.
 *
 * `password` is `min(1)` here, **not** `PASSWORD_MIN_LENGTH`, and that is the same
 * decision the server documents: rejecting a six-character attempt in the browser
 * would answer differently and faster than a ten-character wrong guess, which is a
 * small version of the account-enumeration oracle 1.4 exists to close. Anything
 * non-empty goes to the server and comes back as the one generic message.
 */
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(LOGIN_PASSWORD_MAX_LENGTH),
});

/**
 * Form values → the exact request body one branch of the server's union accepts.
 *
 * Re-parses rather than reading the raw values, so the email that reaches the server
 * is trimmed and lowercased by the same schema that validated it. The resolver
 * validates without writing its transformed output back into form state — the user
 * keeps seeing what they typed — which means this is the only place normalisation
 * actually happens.
 *
 * @param {object} values  the register form's values
 * @returns {import('@tutor/shared').RegisterRequest}
 */
export function toRegisterPayload(values) {
  const {
    email: address,
    password,
    fullName,
    role,
    grade,
    mathLevel,
  } = registerSchema.parse(values);
  const payload = { email: address, password, fullName, role };

  // A teacher sends credentials and nothing else: price, level and topics are set
  // from the teacher's own screens in E2, and the server's `.strict()` rejects the
  // keys outright rather than ignoring them.
  if (role !== 'student') return payload;

  if (grade !== undefined) payload.grade = grade;
  if (mathLevel !== undefined) payload.mathLevel = mathLevel;

  return payload;
}

/**
 * The same, for login. Trivial today; it exists so both screens normalise through
 * their schema rather than one doing it by hand.
 *
 * @param {object} values
 * @returns {import('@tutor/shared').LoginRequest}
 */
export function toLoginPayload(values) {
  return loginSchema.parse(values);
}
