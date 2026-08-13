import { z } from 'zod';

/**
 * Zod schemas for the public teacher surface — `GET /teachers` and
 * `GET /teachers/:id`.
 *
 * **Stubs. Filled in by PR 2.3 (DEV-A), which owns this file.** `teacher.routes.js`
 * is frozen after 2.1 and already imports both names, so the two exports are a
 * contract: the bodies change, the names do not.
 *
 * `teacherByIdSchema` is finished. `teacherListSchema` is not — it accepts no query
 * parameter yet, which is right while the controller throws `NOT_IMPLEMENTED` and
 * has to grow the filter set in 2.3:
 *
 *   topicId     leaf topic id
 *   level       matches `levelMax >= level`
 *   band        A | B | C, resolved through `priceBandRanges()` in `utils/pricing.js`
 *   onlineOnly  boolean, default false
 *   page        1-based, defaults to FIRST_PAGE
 *   pageSize    defaults to DEFAULT_PAGE_SIZE, capped at MAX_PAGE_SIZE
 *
 * The cap is a `.transform()` down to `MAX_PAGE_SIZE`, not a `.max()` rejection: a
 * client asking for 1000 rows gets the cap, because it cannot know our ceiling
 * before it asks. Both numbers come from `constants/pagination.js`, and the price
 * range comes from `constants/money.js` through `utils/pricing.js` — no bound is
 * written as a literal here.
 *
 * `.strict()` stays on `query` whatever gets added. A silently ignored typo in a
 * filter is a bug that looks like an empty result, which is the same posture
 * `public.validator.js` already takes.
 */

/**
 * `GET /teachers` — the public list. A placeholder: no filters, no paging.
 *
 * Empty and strict rather than permissive, so the day 2.3 adds `?topicId=` the
 * schema is what starts accepting it, rather than something that was already
 * waving everything through.
 */
export const teacherListSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
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
