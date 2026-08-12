import { z } from 'zod';

/**
 * Validation for the public surface. MVP.md §16 — every endpoint gets a schema,
 * "including the ones that obviously can't fail" (CONVENTIONS.md → Validation).
 *
 * Both public endpoints take no input at all, which is exactly why the schema is
 * worth writing: `.strict()` turns "this endpoint has no parameters" from a fact
 * about today's code into something the request is checked against. A client that
 * starts sending `?locale=he` gets a 400 naming the field it invented, rather
 * than a silently ignored parameter and a bug report about a page not
 * translating.
 *
 * Only `query` is described. `body` and `params` are left out on purpose —
 * `validate()` writes back nothing for a key the schema does not mention, and a
 * GET route has no body to constrain.
 */

/** `GET /public/topics` and `GET /public/pricing` — no query parameters. */
export const noQuerySchema = z.object({
  query: z.object({}).strict(),
});
