/**
 * Auth parameters. MVP.md §15.5.
 *
 * Not in the PR 0.3 brief — added here because PR 1.1 needs every one of these,
 * and creating the file there would mean an E1 PR editing a `constants/` file
 * mid-epic instead of just importing from it.
 */

/** bcrypt cost factor. */
export const BCRYPT_ROUNDS = 12;

/** Short-lived, kept in memory by the client. Never in localStorage. */
export const ACCESS_TOKEN_TTL = '15m';

/** Long-lived, httpOnly cookie only. */
export const REFRESH_TOKEN_TTL = '7d';

/** Same value in seconds, for `maxAge` on the cookie. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const REFRESH_COOKIE_NAME = 'tn_refresh';

/**
 * The cookie is scoped to the auth router rather than to `/`, so it is not
 * attached to every API call — only `POST /auth/refresh` and `POST /auth/logout`
 * ever need it, and a cookie that is not sent cannot be stolen from a request
 * that had no business carrying it.
 *
 * The path is part of a cookie's identity: `clearCookie` only removes the cookie
 * if the path (and `sameSite` / `secure`) match what `res.cookie` set. That is why
 * both helpers in `auth.token.service.js` build their options from one function.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Minimum password length enforced by the Zod schemas in E1. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Rate limits. The strict limiter guards login, register and question creation
 * (§15.5); the global one is a blanket backstop.
 */
export const RATE_LIMIT = {
  global: { windowMs: 15 * 60 * 1000, max: 300 },
  strict: { windowMs: 15 * 60 * 1000, max: 10 },
};

/**
 * Academic domains that unlock the REGULAR tier. MVP.md §6.2 — the best
 * cost-to-value item in the project: near-zero work, near-impossible to fake.
 */
export const ACADEMIC_DOMAINS = [
  'tau.ac.il',
  'technion.ac.il',
  'huji.ac.il',
  'bgu.ac.il',
  'openu.ac.il',
  'biu.ac.il',
  'ariel.ac.il',
  'hit.ac.il',
];

export const ACADEMIC_CODE_LENGTH = 6;
export const ACADEMIC_CODE_TTL_MINUTES = 15;
