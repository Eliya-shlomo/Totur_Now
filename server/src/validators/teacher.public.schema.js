import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  PRICE_BAND_KEYS,
  TEACHING_LEVELS,
} from '#config/constants/index.js';

/**
 * Zod schemas for the public teacher surface — `GET /teachers` and
 * `GET /teachers/:id`.
 *
 * Every value here arrives as a string, because a query string has no other type.
 * `z.coerce` is what turns `?level=5` into a number before the repository sees it,
 * and `validate()` writes the parsed output back onto `req.query`, so the service
 * receives numbers and booleans rather than strings it would have to parse itself.
 *
 * No bound is a literal. The page sizes come from `constants/pagination.js`, the
 * levels from `constants/teacher.js`, the band keys from `constants/money.js`. A
 * number typed here would be a second copy of one that already exists, and the two
 * would drift the first time somebody edits the original.
 *
 * `.strict()` on all three parts, which is the posture `public.validator.js` already
 * takes: a client that invents `?sortBy=price` gets a `VALIDATION_ERROR` naming the
 * parameter, rather than a silently ignored filter and a bug report about a list
 * "not sorting". A filter that is quietly dropped is worse than one that is
 * rejected — it looks like the data is wrong.
 */

/**
 * `?onlineOnly=true`. Only the two literals; `?onlineOnly=1` is a client bug.
 *
 * The default is the **string** `'false'`, not the boolean. `.default()` feeds its
 * value back through the schema it wraps, so a boolean default would arrive at the
 * enum above and fail the parse of a request that never sent the parameter at all.
 */
const queryBoolean = z
  .enum(['true', 'false'], { message: 'Use true or false.' })
  .transform((value) => value === 'true');

/**
 * `GET /teachers` — the filtered, paged public list.
 *
 * Every filter is optional and they compose. `page` and `pageSize` always resolve to
 * a number, so the service never branches on "did they say".
 *
 * **`band` is a ceiling, not a bracket.** MVP.md §5.2: a student picking B sees
 * bands A and B, because a cheaper teacher must never be hidden from someone willing
 * to pay more. It is resolved through `bandCeiling()` in the service, which is also
 * what the matching hard filter uses (§9.1) — one rule, one implementation.
 * `priceBandRanges()` is the other helper in that file and is for *showing* the
 * filter control, which is 2.5's job, not this one's.
 *
 * `pageSize` is capped by `.transform()` rather than rejected by `.max()`. A client
 * cannot know our ceiling before it asks, so asking for 1000 returns
 * `MAX_PAGE_SIZE` rows — a 400 would turn one over-eager parameter into a blank
 * screen. `total` still reports the true unpaged count, so the client can tell it
 * did not receive everything.
 *
 * `topicId` allows 0. It is a real id — the seeded "General / Unclassified"
 * sentinel (§8.1) — and it is a root, so nothing teaches it and the filter comes
 * back empty. That is an honest empty result rather than a validation error about
 * an id that exists.
 */
export const teacherListSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z
    .object({
      topicId: z.coerce.number().int().min(0, 'That is not a valid topic id.').optional(),
      level: z.coerce
        .number()
        .int()
        .refine((value) => TEACHING_LEVELS.includes(value), {
          message: `Level must be one of: ${TEACHING_LEVELS.join(', ')}.`,
        })
        .optional(),
      band: z.enum(PRICE_BAND_KEYS, { message: 'Unknown price band.' }).optional(),
      onlineOnly: queryBoolean.default('false'),
      page: z.coerce.number().int().min(FIRST_PAGE, 'Pages start at 1.').default(FIRST_PAGE),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Ask for at least one row.')
        .default(DEFAULT_PAGE_SIZE)
        .transform((value) => Math.min(value, MAX_PAGE_SIZE)),
    })
    .strict(),
});

/**
 * `GET /teachers/:id` — one card by user id.
 *
 * The id is a `uuid`: `teacher_profiles.user_id` is `@db.Uuid`, and Postgres raises
 * `22P02` on a malformed uuid rather than returning no rows. Caught here, a typo is
 * a `VALIDATION_ERROR` naming the parameter; uncaught, it is a Prisma exception that
 * surfaces as a 500 for what is plainly a bad request.
 */
export const teacherByIdSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({ id: z.string().uuid('That is not a valid teacher id.') }).strict(),
  query: z.object({}).strict(),
});
