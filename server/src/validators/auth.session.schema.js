import { z } from 'zod';

/**
 * Zod schemas for the session endpoints — login, refresh, logout, me.
 *
 * `auth.routes.js` is frozen after PR 1.1 and already calls each of these by name,
 * so the four exports are a contract: the bodies changed in 1.4, the names did not.
 *
 * `refresh`, `logout` and `me` take no input at all — the refresh token arrives in a
 * cookie and the access token in a header, neither of which `validate()` looks at.
 * They still get a schema, because CONVENTIONS.md allows no exception for endpoints
 * that "obviously can't fail", and because the day one of them grows a body is the
 * day the missing schema is discovered the hard way.
 */

/**
 * The three input-less endpoints.
 *
 * `.strict()` rather than a passthrough: an unexpected key on `POST /auth/refresh`
 * means the caller believes it is sending something that matters, and answering 400
 * says so instead of silently ignoring it. `validate()` writes the parsed result back
 * onto the request, and since none of the three handlers reads `req.body`, stripping
 * it to `{}` costs nothing.
 *
 * `express.json()` leaves `req.body` as `{}` for a request with no body at all, which
 * is what every one of these calls actually sends, so the empty object is the normal
 * case and not a special one.
 */
const noInput = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});

/**
 * `POST /auth/login`.
 *
 * The email is trimmed and lowercased before it reaches the query. Postgres compares
 * `VARCHAR` case-sensitively, so without this `Bob@x.com` and `bob@x.com` are two
 * different accounts to `findUnique` and a user who capitalised their email at
 * registration cannot log in with the keyboard's autocapitalise on a phone. The same
 * normalisation belongs in 1.2's register schema — normalising on only one side of
 * the pair is worse than normalising on neither, because it turns a lookup miss into
 * an account nobody can reach.
 *
 * `password` is `min(1)` and carries no `PASSWORD_MIN_LENGTH` check. This endpoint
 * verifies an existing password rather than setting one: rejecting a six-character
 * attempt with `VALIDATION_ERROR` would answer faster and differently than a
 * ten-character wrong guess, which is a small version of exactly the enumeration
 * oracle the rest of this PR is built to close. Anything non-empty goes to bcrypt and
 * comes back as the one generic 401.
 *
 * `max(255)` mirrors `users.email VARCHAR(255)`; the password cap keeps a megabyte of
 * text out of a deliberately slow hash function.
 */
export const loginSchema = z.object({
  body: z
    .object({
      email: z
        .string()
        .trim()
        .toLowerCase()
        .email('Enter a valid email address.')
        .max(255, 'That email is too long.'),
      password: z.string().min(1, 'Enter your password.').max(200),
    })
    .strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});

/** No input. The credential is the refresh cookie. */
export const refreshSchema = noInput;

/** No input. The cookie is cleared whether or not anything was presented. */
export const logoutSchema = noInput;

/** No input. The credential is the bearer token. */
export const meSchema = noInput;
