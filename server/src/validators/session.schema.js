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
