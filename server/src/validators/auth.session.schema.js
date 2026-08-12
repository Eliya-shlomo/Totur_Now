import { z } from 'zod';

/**
 * Zod schemas for the session endpoints — login, refresh, logout, me.
 * **Placeholders — DEV-B writes the real ones in PR 1.4**, in this file.
 *
 * Same reason as `auth.register.schema.js`: `auth.routes.js` is frozen after PR 1.1
 * and already calls each of these by name, so the four exports are a contract. Fill
 * in the bodies; do not rename them.
 *
 * `refresh`, `logout` and `me` take no input at all — the refresh token arrives in a
 * cookie and the access token in a header, neither of which `validate()` looks at.
 * They still get a schema, because CONVENTIONS.md allows no exception for endpoints
 * that "obviously can't fail", and because the day one of them grows a body is the
 * day the missing schema is discovered the hard way.
 */

/** Passes through untouched — see the note in `auth.register.schema.js`. */
const passthrough = z.object({
  body: z.unknown(),
  params: z.unknown(),
  query: z.unknown(),
});

/** 1.4 replaces with `{ body: { email, password } }`. */
export const loginSchema = passthrough;

/** No input. 1.4 tightens the body to empty. */
export const refreshSchema = passthrough;

/** No input. */
export const logoutSchema = passthrough;

/** No input. */
export const meSchema = passthrough;
