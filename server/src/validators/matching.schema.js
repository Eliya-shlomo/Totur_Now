import { z } from 'zod';

import { PRICE_BAND_KEYS } from '#config/constants/index.js';

/**
 * The Zod schema for `GET /questions/:id/matches` (§12).
 *
 * **Finished in PR 4.1, not stubbed, and 4.5 does not open it.** Two of 4.1's own
 * acceptance criteria are assertions about this file — `?priceBand=D` is a
 * `VALIDATION_ERROR`, a malformed uuid names the parameter — and a stub cannot
 * satisfy them. It is also the whole input: an id and one optional query parameter,
 * which does not grow. Same split 3.1 made, where `questionByIdSchema` shipped
 * finished in the blocking PR and `classificationOverrideSchema` shipped rejecting
 * every body, because the first was already decided and the second was not.
 *
 * `.strict()` on all three parts, the posture every validator in this codebase keeps
 * and the one `teacher.public.schema.js` argues for: a client that invents
 * `?sort=price` should get a `VALIDATION_ERROR` naming the parameter rather than a
 * silently ignored filter and a bug report about a list "not sorting".
 */

/**
 * `GET /questions/:id/matches?priceBand=A|B|C`.
 *
 * The id is a `uuid` because `questions.id` is `@db.Uuid`, and Postgres raises
 * `22P02` on a malformed one rather than returning no rows. Caught here, a typo is a
 * `VALIDATION_ERROR` naming the parameter; uncaught, it is an exception that surfaces
 * as a 500 for what is plainly a bad request. `GET /questions/:id` (3.1) and
 * `GET /teachers/:id` (2.1) both carry the same rule for the same reason.
 *
 * `priceBand` is **optional with no default**. Absent means no ceiling, and
 * `bandCeiling(undefined)` already answers `MAX_PRICE_PER_BLOCK` for exactly this
 * case — "so a typo in a query string does not silently empty the selection screen".
 * It is deliberately not defaulted to `'C'`: today those are the same number, and the
 * day somebody edits `money.js` they are not.
 *
 * The band list is `PRICE_BAND_KEYS`, never a hand-written enum. `money.js` is the
 * one place a band exists, and a second copy here is a filter that keeps accepting a
 * band the product has removed.
 */
export const matchesSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({ id: z.string().uuid('That is not a valid question id.') }).strict(),
  query: z
    .object({
      priceBand: z
        .enum(PRICE_BAND_KEYS, {
          errorMap: () => ({ message: `Price band must be one of ${PRICE_BAND_KEYS.join(', ')}.` }),
        })
        .optional(),
    })
    .strict(),
});
