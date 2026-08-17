import { z } from 'zod';

/**
 * The Zod schema for the teacher's two answers — `POST /offers/:id/accept` and
 * `POST /offers/:id/reject` (MVP.md §12).
 *
 * **Finished in PR 5.1, and 5.4 does not open this file.** One id and no body, which
 * is decided and does not grow.
 *
 * **One schema for both routes, not two identical ones.** They take the same input
 * because they are the same request with a different verb, and two copies would be
 * two things to keep in step for no benefit. If a reject ever grows a reason field —
 * §21's, not this MVP's — that is the day it gets its own schema, and the day the
 * shapes actually differ.
 */

/**
 * `POST /offers/:id/accept` and `POST /offers/:id/reject`.
 *
 * The id is a `uuid` because `offers.id` is `@db.Uuid`, and Postgres raises `22P02`
 * on a malformed one rather than returning no rows.
 *
 * **The body is empty and `.strict()` refuses anything in it.** The teacher's answer
 * is the URL they called; there is nothing to say beyond it. In particular the
 * session id is not accepted here — 5.4 walks offer → session → question from the id
 * in the path, so a client cannot name a session it does not own and have the two
 * disagree.
 */
export const offerByIdSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({ id: z.string().uuid('That is not a valid offer id.') }).strict(),
  query: z.object({}).strict(),
});
