import { z } from 'zod';

import {
  BIO_MAX_LENGTH,
  MAX_PRICE_PER_BLOCK,
  MIN_PRICE_PER_BLOCK,
  TEACHING_LEVELS,
} from '#config/constants/index.js';

/**
 * Zod schemas for the teacher's own record — `GET` and `PATCH /teachers/me`.
 *
 * `teacher.routes.js` is frozen after 2.1 and already calls both of these by name,
 * so the two exports are a contract the way `auth.session.schema.js`'s four were in
 * E1: the bodies changed in 2.2, the names did not.
 *
 * **Not one bound is written here.** The price range, the level set and the bio
 * ceiling all arrive from `#config/constants/` — including inside the messages,
 * because a message reading "between 5 and 20" is the same second copy as a `.min(5)`
 * and drifts from `money.js` just as quietly. The price range in particular exists in
 * three places (the epic README → Risks): this validator, the `CHECK` constraint in
 * `20260811120000_open_marketplace`, and `money.js`. `money.js` is the source and the
 * other two cite it.
 *
 * What this file does **not** check is whether a topic id exists and is a leaf. That
 * is a database question, `validate()` runs `safeParse` rather than `safeParseAsync`,
 * and a validator importing a repository inverts the layering rule
 * (CONVENTIONS.md → Server layering). Shape here, existence in
 * `teacher.me.service.js`, one `VALIDATION_ERROR` naming `topicIds` either way.
 */

/** `GET /teachers/me`. No input; the credential is the bearer token. */
export const teacherMeSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});

/**
 * `GET /teachers/me/stats` — PR 8.5. No input either, and it gets a schema anyway.
 *
 * CONVENTIONS.md → Validation: every endpoint gets one, "including for endpoints that
 * 'obviously can't fail'". The three empty `.strict()` objects are not decoration — they
 * are what makes `?page=2` a `VALIDATION_ERROR` rather than a silently ignored query
 * string, which matters here because the response is deliberately unpaged: a teacher has
 * one row per topic they have been rated in, the taxonomy is fifteen topics, and a client
 * that thinks it is paging is a client reading a truncated breakdown without knowing.
 *
 * A separate export rather than reusing `teacherMeSchema`. They are identical today and
 * the day one of them takes a filter — a level, a date window — sharing would have
 * widened both.
 */
export const teacherStatsSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});

/**
 * The two statuses a teacher may set by hand.
 *
 * `OFFER_LOCKED` and `IN_SESSION` are the matching engine's (E4) and are deliberately
 * absent. It reads like paranoia while E4 does not exist: it stops being paranoia the
 * moment `OFFER_LOCKED` is the flag that prevents a teacher receiving two offers at
 * once, because a teacher who can set it by hand can make themselves permanently
 * unmatchable — or permanently first in line.
 *
 * A local array rather than a constant: `constants/teacher.js` holds what the domain
 * knows about teachers, and "which subset of an enum this one endpoint accepts" is a
 * fact about this endpoint. The full enum lives in `prisma/schema/teachers.prisma`.
 */
const SETTABLE_STATUSES = ['OFFLINE', 'ONLINE'];

/**
 * `PATCH /teachers/me` — bio, price, level, topics, status.
 *
 * Every field is optional, because the stepper (2.4) saves one step at a time and the
 * edit screen (2.6) saves whatever changed. `.strict()` on top of that: an
 * unrecognised key means the caller believes it is saving something, and answering
 * `VALIDATION_ERROR` says so where stripping it silently would not.
 */
const teacherUpdateBody = z
  .object({
    /**
     * `null` clears the bio, and so does `''` — a cleared textarea posts an empty
     * string, and rejecting it would be an error the user cannot act on when they
     * did exactly what the UI offered. Trimmed before the length check, so 500
     * spaces is not a bio.
     */
    bio: z
      .union([
        z.string().trim().max(BIO_MAX_LENGTH, `Keep your bio under ${BIO_MAX_LENGTH} characters.`),
        z.null(),
      ])
      .transform((value) => (value === '' ? null : value))
      .optional(),

    /**
     * `.int()` before the range, so `12.5` fails as "not a whole number" rather than
     * as a range problem it does not have. Credits are integers everywhere in this
     * system (`money.js`), and a fractional price would round somewhere later.
     */
    pricePerBlock: z
      .number()
      .int('Your price has to be a whole number of credits.')
      .min(MIN_PRICE_PER_BLOCK, `The lowest price is ${MIN_PRICE_PER_BLOCK} credits per block.`)
      .max(MAX_PRICE_PER_BLOCK, `The highest price is ${MAX_PRICE_PER_BLOCK} credits per block.`)
      .optional(),

    /**
     * A `refine` against `TEACHING_LEVELS` rather than a union of literals: the union
     * reports "Invalid input" with no mention of what was expected, and this way a
     * level added to the constant extends the endpoint with no edit here.
     */
    levelMax: z
      .number()
      .int()
      .refine((level) => TEACHING_LEVELS.includes(level), {
        message: `Choose a level from ${TEACHING_LEVELS.join(', ')}.`,
      })
      .optional(),

    /**
     * Replaces the whole set — a merge would make removing a topic impossible through
     * this endpoint. Empty is rejected rather than read as "remove them all": the
     * stepper has no button for it, so an empty array is a client bug, and the
     * repository's contract is that `undefined` leaves the rows alone.
     *
     * Deduplicated here because `teacher_topics` is keyed on `(teacher_id, topic_id)`
     * — a multi-select that double-fires would otherwise reach `createMany` and come
     * back as a 500 for what is plainly a bad request.
     */
    topicIds: z
      .array(z.number().int().positive('That is not a valid topic id.'))
      .min(1, 'Choose at least one topic.')
      .transform((ids) => [...new Set(ids)])
      .optional(),

    status: z
      .enum(SETTABLE_STATUSES, {
        errorMap: () => ({ message: `Status can only be ${SETTABLE_STATUSES.join(' or ')}.` }),
      })
      .optional(),
  })
  .strict()
  /**
   * An empty body is a `VALIDATION_ERROR`, not a no-op success. It always means a
   * client bug — a step that sent nothing, or a form that collected nothing — and
   * answering 200 hides it behind a response that looks like a save.
   *
   * Checked on the parsed output, where a missing optional key is genuinely absent
   * rather than present-and-undefined. `{ "bio": null }` is one key and passes:
   * clearing a bio is a real change.
   *
   * The issue lands at the object rather than at a field, so `fieldErrors` reports it
   * under `body`. That is the honest answer — no input is at fault.
   */
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field to update.',
  });

export const teacherUpdateSchema = z.object({
  body: teacherUpdateBody,
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});
