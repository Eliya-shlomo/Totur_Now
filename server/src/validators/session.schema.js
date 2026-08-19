import { z } from 'zod';

/**
 * Zod schemas for the session surface — `POST /sessions/:id/offer` and
 * `GET /sessions/:id` (MVP.md §12).
 *
 * **Finished in PR 5.1, not stubbed, and 5.3 and 5.4 do not open this file.** Three
 * of 5.1's acceptance criteria are assertions about the schemas below — a malformed
 * uuid names the parameter, and `{}`, `{teacherId: 'x'}` and an unknown key are each
 * a `VALIDATION_ERROR` — and a stub cannot satisfy an assertion. It is also the whole
 * input surface for both routes: two ids and one body field, which is decided and
 * does not grow. Same split 3.1 and 4.1 both made.
 *
 * `.strict()` on all three parts, the posture every validator in this codebase keeps.
 * A client that invents `?teacherId=` on the URL, or sends `{ teacher_id }` in snake
 * case, gets a `VALIDATION_ERROR` naming the field rather than an offer sent to
 * nobody and a bug report about a button that "does nothing".
 */

/**
 * `POST /sessions/:id/offer` — the student picking a teacher (5.3).
 *
 * Both ids are uuids because `sessions.id` and `users.id` are `@db.Uuid`, and
 * Postgres raises `22P02` on a malformed one rather than returning no rows. Caught
 * here, a typo is a `VALIDATION_ERROR` naming the parameter; uncaught, it is an
 * exception that surfaces as a 500 for what is plainly a bad request. Every `:id`
 * route in this codebase carries the same rule, since `GET /teachers/:id` in 2.1.
 *
 * **The body is exactly `{ teacherId }` and nothing else.** Not the price — 5.3
 * reads `price_per_block` from the teacher's own row and snapshots that onto the
 * session, because a price that arrives from the client is a price the client can
 * choose. Not the session id either, which is already in the path. E4's selection
 * screen holds `{ teacherId, pricePerBlock }` and sends half of it; the other half
 * is what the screen displays, not what the server trusts.
 */
export const sendOfferSchema = z.object({
  body: z
    .object({
      teacherId: z
        .string({ required_error: 'Pick a teacher.' })
        .uuid('That is not a valid teacher id.'),
    })
    .strict(),
  params: z.object({ id: z.string().uuid('That is not a valid session id.') }).strict(),
  query: z.object({}).strict(),
});

/**
 * `GET /sessions/:id` — what both sides read while an offer is out (5.4).
 *
 * No `authorize` on this route and none implied here: the student and the teacher
 * read the same session, and which one you are decides what you may see. That is an
 * authorisation rule about a row rather than about a role, so it lives in the
 * service — the same call 3.5 made for `GET /questions/:id`. A schema can only check
 * that an id arrived and that it is shaped like one.
 */
export const sessionByIdSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({ id: z.string().uuid('That is not a valid session id.') }).strict(),
  query: z.object({}).strict(),
});

// ── E6 ───────────────────────────────────────────────────────────────────────
//
// **Four of E6's five routes reuse `sessionByIdSchema` above rather than adding four
// identical copies of it.** `GET /:id/video`, `POST /:id/extend`, `POST /:id/end` and
// `POST /:id/report-no-show` each take one uuid in the path and nothing else — extend
// deliberately has no body, because one block is the only thing an extension can buy
// and a quantity in the body is a way to overrun the budget cap in one request.
//
// A second schema with a different name and an identical shape would be a second place
// to forget `.strict()`, and its name would be the only thing distinguishing it. The
// schema's own header says it validates that an id arrived and is shaped like one,
// which is the entire input surface of all four.
//
// `POST /:id/review` is the one that carries a body, and it is below.

/**
 * `POST /sessions/:id/review` — the rating that moves a session to its terminal state
 * (6.6). `ReviewRequest` in `shared/api.d.ts`.
 *
 * **`isResolved` is required and the other two are not.** It is §6.2's core KPI — did
 * this session actually answer the question — and it is the one field the product needs
 * from every rating. Stars and a comment are what a student volunteers.
 *
 * `stars` is `.int().min(1).max(5)`, which is the `CHECK (stars BETWEEN 1 AND 5)`
 * hand-added to the init migration, restated here so a `7` is a `VALIDATION_ERROR`
 * naming the field rather than a constraint violation surfacing as a 500. Two
 * statements of one rule, and they are allowed to be two because one of them is the
 * database's last word and the other is the message the student reads.
 *
 * **`.int()` matters and is not decoration.** `stars` is `@db.SmallInt`; a `4.5`
 * without it reaches Prisma as a float and fails somewhere less legible than here.
 *
 * `comment` is capped at 1000 characters. That number is not in the contract — the
 * column is unbounded `text` — and it is here because an uncapped free-text field on an
 * authenticated endpoint is a row somebody can make a megabyte wide. If the product
 * ever wants a different number it belongs in `constants/`; one caller does not earn a
 * constant.
 *
 * `.strict()` like everything else in this file, so a client sending `{ rating: 5 }`
 * learns that the field is called something else rather than having it dropped.
 */
export const reviewSchema = z.object({
  body: z
    .object({
      isResolved: z.boolean({ required_error: 'Say whether this session solved it.' }),
      stars: z
        .number()
        .int('Stars must be a whole number.')
        .min(1, 'Stars go from 1 to 5.')
        .max(5, 'Stars go from 1 to 5.')
        .optional(),
      comment: z.string().max(1000, 'That comment is too long.').optional(),
    })
    .strict(),
  params: z.object({ id: z.string().uuid('That is not a valid session id.') }).strict(),
  query: z.object({}).strict(),
});
